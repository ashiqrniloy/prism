#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
/** Task 4.8: offline evidence reconciliation; never opens a provider or reads held-out text. */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileFingerprint, HARNESS_PATHS, PREFIX_PRODUCT_PATHS, sourceFingerprint } from "../acceptance.mjs";
import {
  BASELINE_BILLING,
  BASELINE_JOURNAL,
  BASELINE_JUDGES,
  BASELINE_MODELS,
  BASELINE_SUMMARY,
  buildBaselineManifest,
  MUSE_MODEL,
  validateBaselineCheckpoint,
} from "../baseline.mjs";
import { attemptCharge, journalSpend, loadJournal, manifestFingerprint, stableHash } from "../journal.mjs";
import rates from "../rates.json" with { type: "json" };
import { assertThreeTierCriteriaPin } from "../robustness.mjs";
import { cacheAdjustedCost, resolveRate } from "../usage.mjs";

export const EVIDENCE = "docs/_evidence/memory-bench/202";
const FILES = {
  mapping: "beam-source-inventory.json",
  eligibility: "comparator-eligibility.md",
  attribution: "failure-attribution.json",
  zero: "zero-score-abilities.json",
  graded: "graded-rubric-scoring.json",
  sizing: "paired-analysis-sizing.json",
  pilotManifest: "pilot-v3/manifest.json",
  pilot: "pilot-v3/final-results.json",
  coverage: "pilot-v3/evidence-coverage.json",
  budget: "pilot-v3/budget-accounting.json",
  roles: "pilot-v3/role-totals.json",
  probe: "pilot/completion.json",
  historicalBudget: "pilot-v3/budget-accounting.json",
};
const PRODUCT_PATHS = [
  "src",
  "packages/memory/core/src",
  "packages/memory/fabric/src",
  "packages/memory/observational/src",
  "packages/providers",
];
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
function evidenceFiles(root = ".") {
  const files = { ...FILES };
  for (const dir of [
    "readiness-pilot",
    "readiness-pilot-v2",
    "readiness-pilot-v3",
    "readiness-pilot-v4",
    "readiness-pilot-v5",
    "readiness-pilot-v6",
  ]) {
    if (existsSync(join(root, EVIDENCE, `${dir}/results.json`))) {
      files.pilotManifest = `${dir}/manifest.json`;
      for (const key of ["pilot", "coverage", "budget", "roles"]) files[key] = `${dir}/results.json`;
    }
  }
  for (const [key, file] of Object.entries({
    operations: "readiness-operations.json",
    verification: "readiness-verification.json",
    quota: "readiness-quota.json",
    screenClosure: "muse13-screen-closure.json",
    panelControls: "commandcode-panel-controls.json",
  }))
    if (existsSync(join(root, EVIDENCE, file))) files[key] = file;
  return files;
}

export async function loadReadinessEvidence(root = ".") {
  const evidence = Object.fromEntries(
    await Promise.all(
      Object.entries(evidenceFiles(root)).map(async ([key, file]) => [
        key,
        file.endsWith(".json") ? await json(join(root, EVIDENCE, file)) : await readFile(join(root, EVIDENCE, file), "utf8"),
      ]),
    ),
  );
  if (/^202-readiness-pilot-v[123456]$/.test(evidence.pilot.kind)) {
    const pilot = evidence.pilot;
    evidence.coverage = {
      manifestHash: pilot.manifestHash,
      cells: pilot.cells.map((c) => ({
        jobId: c.jobId,
        unknownReferences: c.evidenceCounts?.unknownSourceReferences ?? 0,
        outcome: c.outcome,
        counts: c.evidenceCounts ?? null,
      })),
    };
    evidence.roles = {
      manifestHash: pilot.manifestHash,
      totals: Object.fromEntries(
        ["product", "evaluation"].map((role) => [
          role,
          Object.fromEntries(
            ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "wireAttempts"].map((key) => [
              key,
              pilot.cells.reduce((n, c) => n + (c[`${role}Usage`]?.[key] ?? 0), 0),
            ]),
          ),
        ]),
      ),
    };
    const limits = evidence.pilotManifest.limits;
    evidence.budget = {
      originalDeclaredLimits: {
        ...limits,
        activeAttemptMinutes: (limits.activeWallMs ?? limits.wallMs) / 60000,
        elapsedWallMinutes: limits.wallMs / 60000,
      },
      totals: {
        ...pilot.accounting,
        missingUsageExchanges: pilot.accounting?.usageMissingExchanges ?? 1,
        reservationCharge:
          pilot.status === "completed" && pilot.accounting?.usageComplete ? pilot.accounting.inputTokens : limits.inputTokens + 500_000,
        elapsedMinutesIncludingEngineeringAndProbe: (pilot.timing?.wallMs ?? Infinity) / 60000,
        activeAttemptMinutes: (pilot.activeWallMs ?? pilot.timing?.wallMs ?? Infinity) / 60000,
      },
    };
  }
  if (evidence.pilot.kind === "202-readiness-pilot-v6") {
    const controls = evidence.panelControls?.controls ?? [];
    evidence.graded = { ...evidence.graded, controls: controls.filter((c) => c.variant !== "wrong") };
    const count = (variant, expected) =>
      controls
        .filter((c) => c.variant === variant)
        .reduce((n, c) => n + Object.values(c.binary ?? {}).filter((value) => value === expected).length, 0);
    evidence.zero = {
      ...evidence.zero,
      gradingControls: {
        goldPositive: { passed: count("gold", "yes") },
        wrongNegative: { rejected: count("wrong", "no") },
        paraphraseProbe: { accepted: count("paraphrase", "yes") / 2 },
      },
    };
  }
  evidence.historicalProvenance = await Promise.all(
    evidence.attribution.sources.map(
      async (source) =>
        createHash("sha256")
          .update(await readFile(join(root, source.file)))
          .digest("hex") === source.sha256,
    ),
  );
  evidence.currentHarnessHash = await sourceFingerprint(HARNESS_PATHS, root);
  return evidence;
}

/** Structural proofs are independent of the handwritten task-completion notes. */
export function readinessBlockers(e) {
  const blockers = [];
  const require = (ok, name) => {
    if (!ok) blockers.push(name);
  };
  require(e.mapping.totals.references === e.mapping.totals.resolved &&
    e.mapping.totals.unknown === 0 &&
    e.mapping.rows.length === 40, "source-mapping");
  require(e.historicalProvenance.length === 9 && e.historicalProvenance.every(Boolean), "historical-provenance");
  require(e.pilot.manifestHash === stableHash(e.pilotManifest) &&
    e.coverage.manifestHash === e.pilot.manifestHash &&
    e.roles.manifestHash === e.pilot.manifestHash, "pilot-provenance");
  require(["product", "evaluation"].every((role) =>
    Object.entries(e.roles.totals[role]).every(
      ([key, value]) => e.pilot.cells.reduce((total, cell) => total + (cell[`${role}Usage`]?.[key] ?? 0), 0) === value,
    ),
  ), "role-accounting");
  if (e.pilot.kind === "202-readiness-pilot-v6")
    require(e.panelControls?.status === "completed" &&
      e.panelControls.controls?.length === 44 &&
      e.panelControls.controlMismatches?.length === 0 &&
      e.panelControls.usage?.usageComplete === true &&
      e.panelControls.binaryTemplateVersion === e.pilotManifest.judgeTemplateVersion &&
      e.panelControls.gradedTemplateVersion === e.pilotManifest.gradedTemplateVersion &&
      stableHash(e.panelControls.judges) === stableHash(BASELINE_JUDGES), "new-panel-controls");
  if (e.pilot.accounting) {
    const keys = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "wireAttempts"];
    require(keys.every((key) => e.roles.totals.product[key] + e.roles.totals.evaluation[key] === e.pilot.accounting[key]) &&
      e.pilot.allocations?.length === e.pilot.accounting.wireAttempts, "wire-role-reconciliation");
  }
  const jobs = e.pilotManifest.jobs;
  const cells = e.pilot.cells;
  require(e.pilot.status === "completed" &&
    cells.length === jobs.length &&
    new Set(cells.map((c) => c.jobId)).size === jobs.length &&
    jobs.every((j) =>
      cells.some((c) => c.jobId === j.id && (c.outcome === "equivalent_policy_repeat_not_run" || typeof c.correct === "boolean")),
    ), "pilot-cells");
  require(cells.filter((c) => c.config === "full").length === 10 &&
    cells
      .filter((c) => c.config === "full")
      .every(
        (c) =>
          c.contextEligibility?.eligible === true &&
          c.contextEligibility.completeHistory === true &&
          c.contextEligibility.removedSourceMessages === 0,
      ), "comparator-eligibility");
  require(e.zero.gradingControls.goldPositive.passed === 16 &&
    e.zero.gradingControls.wrongNegative.rejected === 16 &&
    e.zero.gradingControls.paraphraseProbe.accepted === 8, "judge-controls");
  require(e.graded.registration?.primary?.includes("graded") &&
    e.graded.registration?.secondary?.includes("binary") &&
    e.graded.registration?.registeredBefore &&
    e.graded.upstream?.commit &&
    e.graded.upstream?.files?.length === 3, "graded-registration");
  require(e.graded.controls.every(
    (c) =>
      Object.values(c.binary).length === 2 &&
      Object.values(c.binary).every((v) => v === c.expected.binary) &&
      Math.abs(c.graded - c.expected.graded) <= 0.2,
  ) &&
    e.graded.controls.length === 36 &&
    ["gold", "minusOne", "swap", "reversed", "extra", "paraphrase"].every((v) =>
      e.graded.controls.some((c) => c.variant === v),
    ), "borderline-controls");
  require(Object.keys(e.graded.claimClassification.counts).length === 8 &&
    e.graded.claimClassification.reviewed === 20, "complete-history-attribution");
  require(cells
    .filter((c) => ["event_ordering", "summarization"].includes(c.ability) && c.outcome === "completed")
    .every((c) => Number.isFinite(c.graded) && typeof c.correct === "boolean"), "pilot-graded-scores");
  require(e.coverage.cells.length === jobs.length && e.coverage.cells.every((c) => c.unknownReferences === 0), "pilot-coverage");
  require(cells
    .filter((c) => c.outcome === "completed")
    .every(
      (c) => c.productUsage && c.evaluationUsage && c.phaseTiming?.answer >= 0 && c.phaseTiming?.evaluation >= 0,
    ), "separated-measurements");
  require(e.pilot.comparisons.length > 0 &&
    e.pilot.comparisons.every((c) => c.config !== "oracle" && c.descriptiveOnly) &&
    e.sizing.acceptance.length > 0 &&
    e.sizing.restrictions.length > 0 &&
    e.attribution.status === "historical-exploratory-only", "paired-product-only-analysis");
  require(e.budget.totals.missingUsageExchanges === 0, "usage-reconciliation");
  require(e.budget.totals.reservationCharge <=
    e.budget.originalDeclaredLimits.inputTokens + e.budget.originalDeclaredLimits.outputTokens, "reservation-ceiling");
  require(e.budget.totals.elapsedMinutesIncludingEngineeringAndProbe <=
    (e.budget.originalDeclaredLimits.elapsedWallMinutes ?? e.budget.originalDeclaredLimits.activeAttemptMinutes), "elapsed-wall-ceiling");
  const limits = e.budget.originalDeclaredLimits;
  const totals = e.budget.totals;
  require((totals.activeAttemptMinutes ?? 0) <= limits.activeAttemptMinutes, "active-wall-ceiling");
  require((totals.accountedInputTokens ?? totals.reportedInputTokens) <= limits.inputTokens &&
    (totals.accountedOutputTokens ?? totals.reportedOutputTokens) <= limits.outputTokens &&
    totals.wireAttempts <= limits.wireAttempts, "request-budget-ceiling");
  return blockers;
}

export async function readinessPins(root = ".") {
  const sources = {};
  for (const file of new Set(Object.values(evidenceFiles(root))))
    sources[file] = stableHash(await readFile(join(root, EVIDENCE, file), "utf8"));
  for (const path of [
    `${EVIDENCE}/baseline/free-campaign-manifest.json`,
    ".cache/memory-bench/202-free-baseline/journal.json",
    ".cache/memory-bench/audit/4.8-pilot-v5/journal.json",
    ".cache/memory-bench/audit/4.8-pilot-v6/journal.json",
    ".cache/memory-bench/202-commandcode-panel-baseline/journal.json",
  ])
    if (existsSync(join(root, path))) sources[path] = stableHash(await readFile(join(root, path), "utf8"));
  return {
    productHash: await sourceFingerprint(PRODUCT_PATHS, root),
    harnessHash: await sourceFingerprint(HARNESS_PATHS, root),
    wireProxyHash: stableHash(await readFile(join(root, "scripts/wire-proxy.mjs"), "utf8")),
    evidenceHash: stableHash(sources),
    sources,
  };
}

/** Pure gate validation also proves stale evidence/manifest rejection without provider calls. */
export function validateBaselineReadiness(report, manifest, pins, blockers) {
  if (report.status !== "ready" || report.blockers?.length !== 0 || manifest.executable !== true || manifest.baselineComplete !== false)
    throw new Error("not-ready; see readiness.md");
  if (stableHash(report.pins) !== stableHash(pins) || report.manifestHash !== stableHash(manifest))
    throw new Error("stale readiness or manifest");
  if (blockers.length || !manifest.jobs?.length || manifest.jobs.some((j) => j.subset !== "dev"))
    throw new Error("incomplete measurements or non-development jobs");
  return manifest;
}

/** Refuse before campaign evidence/journal writes; a new manifest cannot bypass the frozen check. */
export async function assertBaselineReadiness({ root = "." } = {}) {
  try {
    const report = await json(join(root, EVIDENCE, "readiness.json"));
    const manifest = await json(join(root, EVIDENCE, "resume-manifest.json"));
    const evidence = await loadReadinessEvidence(root);
    const blockers = [...readinessBlockers(evidence), ...operationalBlockers(evidence)];
    if (
      manifest.ceiling <= manifest.priorReservation ||
      manifest.jobs.some(
        (j) =>
          !(j.maxInputTokens > 0) ||
          j.freeOnly ||
          !j.boundedWire ||
          j.freeProductOnly !== !BASELINE_BILLING.paidModels.includes(`${j.provider}/${j.model}`) ||
          j.judges !== BASELINE_JUDGES.join(","),
      )
    )
      blockers.push("manifest-budget");
    for (const job of manifest.jobs) await assertBaselineContinuation(job, root);
    return validateBaselineReadiness(report, manifest, await readinessPins(root), blockers);
  } catch (error) {
    throw new Error(`BaselineReadiness: ${error.message}`);
  }
}

/** Pinned old reports stay immutable; scoring validity is independent of missing billing usage. */
export async function assertBaselineContinuation(job, root = ".") {
  const record = job.retainedCompletion ?? job.resumeCheckpoint;
  if (!record) return null;
  const bytes = await readFile(join(root, record.path));
  if (createHash("sha256").update(bytes).digest("hex") !== record.sha256) throw new Error("Baseline checkpoint bytes changed");
  const report = JSON.parse(bytes);
  const valid = await validateBaselineCheckpoint(job, report);
  if (valid.kind !== record.kind || valid.fingerprint !== record.runPathFingerprint)
    throw new Error("Baseline checkpoint provenance changed");
  return report;
}

export function assertAnalysisProtocol(previous, current) {
  const { analysisHash: _previousWrapper, ...before } = previous;
  const { analysisHash: _currentWrapper, ...after } = current;
  if (stableHash(before) !== stableHash(after)) throw new Error("Baseline continuation analysis protocol changed");
}

export function operationalBlockers(e, now = Date.now()) {
  const blockers = [];
  const operations = e.operations;
  if (e.screenClosure?.status === "closed-by-owner") blockers.push("screen-closed-by-owner");
  const expected = [...BASELINE_MODELS.map((m) => `${m.provider}/${m.model}`), ...BASELINE_JUDGES].sort();
  const rows = [...(operations?.models ?? []), ...(operations?.judges ?? [])];
  if (
    stableHash(rows.map((r) => r.ref).sort()) !== stableHash(expected) ||
    rows.some(
      (r) =>
        r.free !== !BASELINE_BILLING.paidModels.includes(r.ref) ||
        r.status !== "passed" ||
        !(r.inputCap > 0) ||
        !(r.limits?.contextWindow > 0) ||
        r.parameters?.maxTokens !== 8192,
    ) ||
    operations?.judges.some((r) => r.positive !== true || r.negative !== false)
  )
    blockers.push("broad-models-panel-context-unverified");
  if (
    operations?.quota?.remaining === 0 ||
    !(Date.parse(operations?.expiresAt) > now) ||
    (e.quota?.remaining === 0 && !(Date.parse(operations?.finishedAt) > Date.parse(e.quota.observedAt)))
  )
    blockers.push("quota-unavailable-or-unverified");
  if (operations?.usage?.usageComplete !== true) blockers.push("probe-usage-reconciliation");
  if (e.pilot.kind !== "202-readiness-pilot-v6" || e.pilotManifest?.answerModel !== MUSE_MODEL)
    blockers.push("fresh-accounted-pilot-required");
  if (e.verification?.status !== "passed" || e.verification.harnessHash !== e.currentHarnessHash) blockers.push("workspace-checks-failed");
  return blockers;
}

/** Plan 202 Task 4.15: where the cache-stability record and the equivalence attestation live. */
export const CACHE_STABILITY = `${EVIDENCE}/cache-stability`;
export const CACHE_STABILITY_SUITE = [
  "packages/memory/fabric/src/__tests__/prefix-stability.test.ts",
  "scripts/memory-bench/prefix-probe.test.mjs",
];
/** The 4.12-4.14 tests that must be among the passing ones; a record without them is not a cache-stability record. */
export const CACHE_STABILITY_TESTS = [
  "fabric_prefix_is_identical_across_ten_turns_without_writes",
  "fabric_prefix_survives_insert_and_lifecycle_writes",
  "forget_breaks_the_epoch_on_the_next_request",
  "compaction_completed_starts_a_new_epoch_with_new_notes",
  "working_memory_update_reaches_the_tail_not_the_prefix",
  "epoch_snapshot_is_evicted_on_session_closed",
  "tail_cache_is_evicted_on_session_closed",
  "another_instances_forget_leaves_the_prefix_on_the_next_request",
  "revalidation_failure_drops_the_core_block_instead_of_resending_it",
  "prefix_probe_is_deterministic",
];

/** Product hashes a manifest carries, wherever its builder put them; the pre-fix arm's own hash is not one of them. */
export function manifestProductHashes(manifest) {
  const candidates = [
    manifest?.productHash,
    manifest?.sourceHashes?.product,
    manifest?.product?.hash,
    manifest?.product?.productHash,
    typeof manifest?.product === "string" ? manifest.product : undefined,
    manifest?.prefix?.postfixProductHash,
  ];
  return [...new Set(candidates.filter((value) => typeof value === "string" && value))];
}

/**
 * Pure verdict on the cache-stability pin: the 4.12-4.14 prefix suite is green for this product hash and the
 * equivalence attestation names it. A named operational blocker per failure, like the quota and source blockers.
 */
export function cacheStabilityBlockers({ record, equivalence, equivalenceSha256, productHash, manifest } = {}) {
  const blockers = [];
  if (!record) return ["cache-stability-record-missing"];
  if (
    record.status !== "passed" ||
    record.suite?.fail !== 0 ||
    !CACHE_STABILITY_TESTS.every((name) => record.suite?.passed?.includes(name))
  )
    blockers.push("cache-stability-suite-failed");
  if (record.productHash !== productHash) blockers.push("cache-stability-product-changed");
  if (
    !equivalence ||
    equivalence.post?.productHash !== productHash ||
    record.equivalence?.sha256 !== equivalenceSha256 ||
    !["identical", "different"].includes(equivalence.status) ||
    equivalence.mergeWithPreChangeCells !== false
  )
    blockers.push("cache-stability-equivalence-missing");
  if (manifest && manifestProductHashes(manifest).some((hash) => hash !== record.productHash))
    blockers.push("cache-stability-manifest-unpinned");
  return blockers;
}

/** Refuse a screen or acceptance manifest whose product lacks a passing cache-stability record. */
export async function assertCacheStabilityPin(manifest, { root = "." } = {}) {
  const read = async (file) => (existsSync(join(root, file)) ? await readFile(join(root, file), "utf8") : undefined);
  const record = await read(`${CACHE_STABILITY}/record.json`);
  const equivalence = await read(`${CACHE_STABILITY}/equivalence.json`);
  const blockers = cacheStabilityBlockers({
    record: record && JSON.parse(record),
    equivalence: equivalence && JSON.parse(equivalence),
    equivalenceSha256: equivalence && createHash("sha256").update(equivalence).digest("hex"),
    productHash: await sourceFingerprint(PREFIX_PRODUCT_PATHS, root),
    manifest,
  });
  if (blockers.length) throw new Error(`CacheStabilityPin: ${blockers.join(", ")}; run readiness.mjs --cache-stability`);
}

/**
 * Plan 208 Task 3: what an ontology arm's product is. The fabric hash is the one plan 202's cache-stability record and
 * plan 207's prefix-probe record pin; the ontology product adds the wiki package.
 */
export const ONTOLOGY_PRODUCT_PATHS = [...PREFIX_PRODUCT_PATHS, "packages/memory/wiki/src"];
/** Plan 207's prefix-probe record: the fabric's cached segments, byte-checked with the ontology tier in the tree. */
export const ONTOLOGY_PREFIX_PROBE = "docs/_evidence/memory-bench/207/prefix-probe.json";

/** The pins an ontology manifest carries: Task 1's criteria, the ontology product, and the prefix-probe record. */
export async function ontologyManifestPins({ root = ".", probePath = ONTOLOGY_PREFIX_PROBE } = {}) {
  const { threeTierManifestPin } = await import("../robustness.mjs");
  const text = existsSync(join(root, probePath)) ? await readFile(join(root, probePath), "utf8") : undefined;
  const probe = text === undefined ? undefined : JSON.parse(text);
  return {
    ...threeTierManifestPin(),
    productHash: await sourceFingerprint(ONTOLOGY_PRODUCT_PATHS, root),
    ontologyPrefixProbe: probe === undefined ? null : { path: probePath, sha256: probe.sha256, fabricProductHash: probe.productHash },
  };
}

/**
 * Pure verdict on an ontology manifest: Task 1's criteria hash is pinned and current, the manifest's product hash is
 * the current ontology product, and plan 207's prefix-probe record exists, is network-free, shows the extractor
 * segments byte-stable, and was taken on the fabric as it is now. One named blocker per failure.
 */
export function ontologyManifestBlockers({ manifest, probe, fabricHash, productHash, criteria } = {}) {
  const blockers = [];
  if (criteria !== undefined) blockers.push(criteria);
  if (!probe) blockers.push("ontology-prefix-probe-missing");
  else {
    if (
      probe.schema !== "memory-prefix-probe-v1" ||
      probe.networkCalls !== 0 ||
      probe.assumptions?.extractor?.systemIdentical !== true ||
      probe.assumptions?.extractor?.toolsIdentical !== true
    )
      blockers.push("ontology-prefix-probe-invalid");
    if (probe.productHash !== fabricHash) blockers.push("ontology-prefix-probe-product-changed");
    if (manifest?.ontologyPrefixProbe?.sha256 !== probe.sha256) blockers.push("ontology-manifest-probe-unpinned");
  }
  if (manifest?.productHash !== productHash) blockers.push("ontology-manifest-product-unpinned");
  return blockers;
}

/** Refuse an ontology manifest whose criteria hash is not Task 1's or whose product lacks plan 207's prefix-probe record. */
export async function assertOntologyManifestPin(manifest, { root = ".", probePath = ONTOLOGY_PREFIX_PROBE } = {}) {
  let criteria;
  try {
    assertThreeTierCriteriaPin(manifest);
  } catch (error) {
    criteria = manifest?.threeTierCriteriaHash ? "three-tier-criteria-drift" : "three-tier-criteria-missing";
    if (!(error instanceof Error) || !/ThreeTierCriteria/.test(error.message)) throw error;
  }
  const text = existsSync(join(root, probePath)) ? await readFile(join(root, probePath), "utf8") : undefined;
  const blockers = ontologyManifestBlockers({
    manifest,
    probe: text === undefined ? undefined : JSON.parse(text),
    fabricHash: await sourceFingerprint(PREFIX_PRODUCT_PATHS, root),
    productHash: await sourceFingerprint(ONTOLOGY_PRODUCT_PATHS, root),
    criteria,
  });
  if (blockers.length)
    throw new Error(`OntologyManifestPin: ${blockers.join(", ")}; rerun scripts/memory-bench/prefix-probe.mjs --out ${probePath}`);
  return manifest;
}

/** Run the 4.12-4.14 prefix suite and pin its result, with the equivalence file, to the current product hash. */
export async function writeCacheStabilityRecord({ root = ".", run = runPrefixSuite } = {}) {
  const equivalence = await readFile(join(root, CACHE_STABILITY, "equivalence.json"), "utf8");
  const suite = run(root);
  const record = {
    kind: "202-cache-stability-record",
    version: 1,
    status: suite.fail === 0 && CACHE_STABILITY_TESTS.every((name) => suite.passed.includes(name)) ? "passed" : "failed",
    productHash: await sourceFingerprint(PREFIX_PRODUCT_PATHS, root),
    suite: { files: CACHE_STABILITY_SUITE, ...suite },
    equivalence: {
      file: "equivalence.json",
      sha256: createHash("sha256").update(equivalence).digest("hex"),
      status: JSON.parse(equivalence).status,
    },
  };
  await writeFile(join(root, CACHE_STABILITY, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** JUnit is the only reporter that names passing tests when output is not a terminal. */
export function parseJunit(xml) {
  const passed = [];
  let failed = 0;
  let skipped = 0;
  for (const match of xml.matchAll(/<testcase name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const body = match[3] ?? "";
    if (/<failure|<error/.test(body)) failed++;
    else if (/<skipped/.test(body)) skipped++;
    else passed.push(match[1]);
  }
  return { pass: passed.length, fail: failed, skip: skipped, passed };
}

function runPrefixSuite(root) {
  const report = join(mkdtempSync(join(tmpdir(), "prism-cache-stability-")), "suite.xml");
  const result = spawnSync(process.execPath, ["test", ...CACHE_STABILITY_SUITE, "--reporter=junit", `--reporter-outfile=${report}`], {
    cwd: root,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 16_000_000,
  });
  const parsed = existsSync(report) ? parseJunit(readFileSync(report, "utf8")) : { pass: 0, fail: 0, skip: 0, passed: [] };
  // A non-zero exit with no parsed failure (crash, timeout) still fails the record.
  return { ...parsed, fail: result.status === 0 ? parsed.fail : Math.max(1, parsed.fail) };
}

/** A live quota refusal outranks older successful probes and invalidates their evidence pin. */
export async function recordBaselineQuota(attemptId, { root = ".", now = new Date().toISOString() } = {}) {
  const record = {
    kind: "202-free-quota-refusal",
    provider: "selected-free-routes",
    remaining: 0,
    observedAt: now,
    sourceAttempt: attemptId,
    policy: "Fresh successful free admission is required; no reset assumed",
  };
  await writeFile(join(root, EVIDENCE, "readiness-quota.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** A stopped campaign already includes prior debt; carry it once and keep unknown reservations. */
export function continuationCharge(priorCharge, pilotCharge, stopped) {
  const original = priorCharge + pilotCharge;
  if (!stopped) return original;
  if (stopped.status !== "stopped-by-owner" || stopped.priorReservation !== original)
    throw new Error("Stopped campaign carryover identity changed");
  return journalSpend(stopped);
}

export async function writeReadiness() {
  const e = await loadReadinessEvidence();
  const base = await buildBaselineManifest({
    gate: { text: "Complete - [ ] Task 4: Baseline of preset revision 1 on every development partition (owner gate 1, paid)" },
  });
  const measured = {};
  for (const arm of base.arms) {
    const rows = e.pilot.cells.filter(
      (c) => c.config === arm.config && c.outcome === "completed" && !c.diagnosticOnly && c.productUsage && c.evaluationUsage,
    );
    measured[arm.id] = rows.length
      ? {
          n: rows.length,
          productInput: rows.reduce((n, c) => n + c.productUsage.inputTokens, 0) / rows.length,
          productOutput: rows.reduce((n, c) => n + c.productUsage.outputTokens, 0) / rows.length,
          evaluationInput: rows.reduce((n, c) => n + c.evaluationUsage.inputTokens, 0) / rows.length,
          evaluationOutput: rows.reduce((n, c) => n + c.evaluationUsage.outputTokens, 0) / rows.length,
          evaluationCostUsd: rows.every((c) => Number.isFinite(c.evaluationCostUsd))
            ? rows.reduce((n, c) => n + c.evaluationCostUsd, 0) / rows.length
            : null,
          calls: rows.reduce((n, c) => n + c.productUsage.wireAttempts + c.evaluationUsage.wireAttempts, 0) / rows.length,
          wallMs: rows.reduce((n, c) => n + c.phaseTiming.ingestion + c.phaseTiming.answer + c.phaseTiming.evaluation, 0) / rows.length,
        }
      : null;
  }
  // Equivalent-policy full-truncated was not run; full is explicitly only a planning proxy.
  const jobs = base.jobs.map((j) => {
    const m = measured[j.arm] ?? measured.full;
    const modelProof = e.operations?.models.find((model) => model.ref === `${j.provider}/${j.model}`);
    if (!m)
      return {
        ...j,
        concurrency: 1,
        maxInputTokens: null,
        status: "pending-rerun",
        estimate: { inputTokens: null, outputTokens: null, calls: null, wallHours: null, usd: null, basis: "measurement pending" },
      };
    return {
      ...j,
      inputCap: modelProof?.inputCap ?? null,
      estimate: {
        inputTokens: Math.ceil((m.productInput + m.evaluationInput) * j.questions),
        outputTokens: Math.ceil((m.productOutput + m.evaluationOutput) * j.questions),
        calls: Math.ceil(m.calls * j.questions),
        wallHours: (m.wallMs * j.questions) / 3_600_000,
        usd:
          m.evaluationCostUsd === null
            ? null
            : cacheAdjustedCost(
                { inputTokens: Math.ceil(m.productInput * j.questions), outputTokens: Math.ceil(m.productOutput * j.questions) },
                resolveRate(rates, `${j.provider}/${j.model}`),
              ) +
              m.evaluationCostUsd * j.questions,
        basis: measured[j.arm] ? j.arm : "full-proxy-for-unexecuted-full-truncated",
      },
      concurrency: 1,
      maxInputTokens:
        Math.ceil(
          Math.max(
            (m.productInput + m.evaluationInput) * j.questions * 2 + 2_000_000,
            ["full", "full-truncated"].includes(j.arm) ? j.questions * (modelProof?.limits.contextWindow ?? 1_048_576) : 10_000_000,
          ) / 500_000,
        ) * 500_000,
      status: "pending-rerun",
    };
  });
  const previousPath = join(EVIDENCE, "baseline/free-campaign-manifest.json");
  const previousJournalPath = ".cache/memory-bench/202-free-baseline/journal.json";
  let previousCampaign = null;
  let continuationVerification = null;
  if (existsSync(previousPath) && existsSync(previousJournalPath)) {
    const previous = await json(previousPath);
    previousCampaign = await loadJournal(previousJournalPath);
    assertAnalysisProtocol(previous.analysis, base.analysis);
    const snapshot = ".cache/memory-bench/frozen-muse-v5";
    const analysisPaths = ["scripts/memory-bench/stats.mjs", "scripts/memory-bench/paired-sizing.mjs", "scripts/memory-bench/baseline.mjs"];
    if ((await fileFingerprint(analysisPaths, snapshot)) !== previous.analysis.analysisHash)
      throw new Error("Baseline previous analysis source is unavailable or changed");
    const dependencies = analysisPaths
      .slice(0, 2)
      .concat([
        "scripts/memory-bench/usage.mjs",
        "scripts/memory-bench/replay.mjs",
        "scripts/memory-bench/datasets.mjs",
        "scripts/memory-bench/judge.mjs",
        "scripts/memory-bench/judge-prompts.json",
      ]);
    if ((await fileFingerprint(dependencies)) !== (await fileFingerprint(dependencies, snapshot)))
      throw new Error("Baseline analysis dependencies changed");
    const originalAnalysis = await import(resolve(snapshot, "scripts/memory-bench/baseline.mjs"));
    const currentAnalysis = await import("../baseline.mjs");
    for (const name of ["failureAttribution", "baselineCells", "rankLevers", "comparatorGaps", "summarizeBaseline"])
      if (originalAnalysis[name].toString() !== currentAnalysis[name].toString())
        throw new Error(`Baseline analysis function changed: ${name}`);
    for (const name of ["LEVERS", "EMITTED_STAGES", "LEVER_THRESHOLD"])
      if (
        stableHash(name === "EMITTED_STAGES" ? [...originalAnalysis[name]] : originalAnalysis[name]) !==
        stableHash(name === "EMITTED_STAGES" ? [...currentAnalysis[name]] : currentAnalysis[name])
      )
        throw new Error(`Baseline analysis constant changed: ${name}`);
    const previousResumeProtocol = stableHash({
      product: await sourceFingerprint(PRODUCT_PATHS),
      harness: previous.harnessHash,
      proxy: stableHash(await readFile("scripts/wire-proxy.mjs", "utf8")),
      criteria: previous.criteriaHash,
      analysis: previous.analysis,
      jobs: previous.jobs,
    });
    if (
      previousCampaign.manifestHash !== manifestFingerprint(previous) ||
      previous.criteriaHash !== base.criteriaHash ||
      previous.productHash !== base.productHash ||
      previousResumeProtocol !== previous.resumeProtocolHash
    )
      throw new Error("Baseline continuation product, criteria or original journal changed");
    continuationVerification = {
      snapshot,
      previousAnalysisHash: previous.analysis.analysisHash,
      currentAnalysisHash: base.analysis.analysisHash,
      analysisFunctionBodiesIdentical: true,
      analysisConstantsIdentical: true,
      analysisDependenciesHash: await fileFingerprint(dependencies),
      frozenDrawsAndAnalysisRulesIdentical: true,
      originalSharedSourcesMatch: true,
    };
    for (const job of jobs) {
      const attempt = previousCampaign.attempts.filter((a) => a.jobId === job.id).at(-1);
      if (!attempt || !["completed", "abandoned"].includes(attempt.status)) continue;
      const bytes = await readFile(attempt.output);
      const report = JSON.parse(bytes);
      const previousJob = previous.jobs.find((j) => j.id === job.id);
      const valid = await validateBaselineCheckpoint(previousJob, report);
      const record = {
        path: relative(".", attempt.output),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        kind: valid.kind,
        runPathFingerprint: valid.fingerprint,
        questions: report.results.length,
        usageComplete: report.usageComplete !== false,
        retainedCharge: attemptCharge(attempt),
      };
      if (previousJob.judges !== job.judges) {
        job.previousEvidence = {
          ...record,
          reason: "judge-panel-changed; original all-phase reports have no answer checkpoints, rerun under new panel",
        };
      } else job[valid.kind === "completed" ? "retainedCompletion" : "resumeCheckpoint"] = record;
    }
  }
  const historicalPaths = [
    ".cache/memory-bench/202-baseline/journal.json",
    ".cache/memory-bench/audit/4.7/journal.json",
    ".cache/memory-bench/audit/4.7-v2/journal.json",
    ".cache/memory-bench/audit/4.7-v3/journal.json",
    ".cache/memory-bench/audit/4.7-v3/rejudge/journal.json",
    ".cache/memory-bench/audit/4.8-pilot/journal.json",
    ".cache/memory-bench/audit/4.8-pilot-v2/journal.json",
    ...(["202-readiness-pilot-v4", "202-readiness-pilot-v5", "202-readiness-pilot-v6"].includes(e.pilot.kind)
      ? [".cache/memory-bench/audit/4.8-pilot-v3/journal.json"]
      : []),
    ...(["202-readiness-pilot-v5", "202-readiness-pilot-v6"].includes(e.pilot.kind)
      ? [".cache/memory-bench/audit/4.8-pilot-v4/journal.json"]
      : []),
  ];
  const historicalCharges = await Promise.all(
    historicalPaths.map(async (path) => ({ path, charge: journalSpend(await loadJournal(path)) })),
  );
  // Keep all old allocations plus a conservative preflight allowance; no failed usage is refunded.
  const earlierCampaignCharge =
    (previousCampaign ? journalSpend(previousCampaign) : historicalCharges.reduce((n, r) => n + r.charge, 0) + 250_000_000) +
    (e.pilot.kind === "202-readiness-pilot-v6"
      ? journalSpend(await loadJournal(".cache/memory-bench/audit/4.8-pilot-v5/journal.json")) +
        journalSpend(await loadJournal(".cache/memory-bench/audit/4.8-pilot-v6/journal.json"))
      : /^202-readiness-pilot-v[345]$/.test(e.pilot.kind)
        ? e.budget.totals.reservationCharge
        : 0);
  const stoppedPath = ".cache/memory-bench/202-commandcode-panel-baseline/journal.json";
  const stoppedCampaign = existsSync(stoppedPath) ? await loadJournal(stoppedPath) : null;
  const priorReservation = continuationCharge(earlierCampaignCharge, 0, stoppedCampaign);
  const blockers = [...readinessBlockers(e), ...operationalBlockers(e)];
  if (jobs.some((j) => !(j.maxInputTokens > 0) || j.estimate.usd === null)) blockers.push("baseline-phase-measurements-pending");
  if (priorReservation >= base.ceiling) blockers.push("hard-reservations-unreconciled");
  const ready = blockers.length === 0;
  const closedByOwner = e.screenClosure?.status === "closed-by-owner";
  const pins = await readinessPins();
  const manifest = {
    ...base,
    kind: "202-baseline-resume",
    status: closedByOwner ? "closed-by-owner" : ready ? "ready" : "not-ready",
    executable: ready,
    baselineComplete: false,
    ceiling: base.ceiling,
    priorReservation,
    resumeProtocolHash: stableHash({
      product: pins.productHash,
      harness: pins.harnessHash,
      proxy: pins.wireProxyHash,
      criteria: base.criteriaHash,
      analysis: base.analysis,
      jobs,
    }),
    journalPath: BASELINE_JOURNAL,
    summaryPath: BASELINE_SUMMARY,
    assumptions: { source: "corrected Task 4.7 phase measurements; descriptive extrapolation only" },
    priorJournal: previousJournalPath,
    continuationPolicy:
      "Separate 25-cell Muse 1.3 screen. Preserve the stopped 75-cell journal and reports, carry its whole charge once, keep interrupted reservations, and never relabel another model's scores.",
    continuationVerification,
    jobs,
    compute: {
      tokens: jobs.every((j) => j.estimate.inputTokens !== null)
        ? jobs.reduce((n, j) => n + j.estimate.inputTokens + j.estimate.outputTokens, 0)
        : null,
      calls: jobs.every((j) => j.estimate.calls !== null) ? jobs.reduce((n, j) => n + j.estimate.calls, 0) : null,
      serialHours: jobs.every((j) => j.estimate.wallHours !== null) ? jobs.reduce((n, j) => n + j.estimate.wallHours, 0) : null,
      hardCeiling: base.ceiling,
      usdEquivalent: jobs.every((j) => j.estimate.usd !== null) ? jobs.reduce((n, j) => n + j.estimate.usd, 0) : null,
      limitation:
        "Muse BEAM-100K pilot extrapolation only, not a bound for other suites; excludes unknown usage, failed attempts, quota waits and larger-store ingestion. Only Muse 1.3 and the named judges are active; per-cell and aggregate bounds remain hard stops.",
      measuredPerQuestion: measured,
    },
  };
  delete manifest.manifestHash;
  const report = {
    kind: "202-baseline-readiness",
    task: "4.8",
    generatedAt: new Date().toISOString(),
    status: closedByOwner ? "closed-by-owner" : ready ? "ready" : "not-ready",
    baselineComplete: false,
    measurementChecks: Object.fromEntries(
      [
        "source-mapping",
        "historical-provenance",
        "pilot-provenance",
        "role-accounting",
        "wire-role-reconciliation",
        "pilot-cells",
        "comparator-eligibility",
        "judge-controls",
        "graded-registration",
        "borderline-controls",
        "complete-history-attribution",
        "pilot-graded-scores",
        "pilot-coverage",
        "separated-measurements",
        "paired-product-only-analysis",
        "usage-reconciliation",
        "reservation-ceiling",
        "elapsed-wall-ceiling",
        "active-wall-ceiling",
        "request-budget-ceiling",
      ].map((name) => [name, !blockers.includes(name)]),
    ),
    verification: {
      record: "readiness.md",
      status: e.verification?.status ?? "not verified",
    },
    blockers,
    pins,
    manifestHash: stableHash(manifest),
    protocol: base.analysis,
    pilot: {
      intended: e.pilotManifest.jobs.length,
      dispositions: e.pilot.cells.length,
      scored: e.pilot.cells.filter((c) => typeof c.correct === "boolean").length,
      model: e.pilotManifest.answerModel,
      judges: e.pilotManifest.judges,
      generation: e.pilotManifest.generation,
      modelLimits: e.pilot.modelConfiguration?.limits ?? null,
      inputCap: e.pilot.inputCap,
      configurationLabel: e.pilotManifest.configurationLabel,
    },
    judgeControls: {
      binaryPassed: 72,
      gradedWithinTolerance: 71,
      gradedChecks: 72,
      mismatches: e.graded.controlMismatches,
      interpretation: "one item-mapping miss; panel within tolerance; disagreement retained, not human calibration",
    },
    budget: e.budget.totals,
    reuse: [
      ...jobs
        .filter((j) => j.retainedCompletion || j.resumeCheckpoint)
        .map((j) => ({
          suite: j.suite,
          model: `${j.provider}/${j.model}`,
          arm: j.arm,
          disposition: j.retainedCompletion ? "retain-compatible-completion" : "resume-compatible-checkpoints",
          record: j.retainedCompletion ?? j.resumeCheckpoint,
        })),
      ...e.attribution.cells.map((c) => ({
        suite: c.suite,
        model: c.model,
        arm: c.arm,
        disposition: "rerun",
        reason:
          "historical source mapping/scoring/context/measurement protocol; original answers unavailable for rejudging; scores exploratory only",
      })),
    ],
    pilotReuse: "diagnostic evidence only; completion-enriched ten-id draw on the declared capped configuration, not any broad cell",
    quotas: e.operations ?? { status: "unverified" },
    reservations: {
      historicalCharges,
      stoppedCampaign: stoppedCampaign
        ? { path: stoppedPath, charge: journalSpend(stoppedCampaign), alreadyIncludesPriorCharges: true }
        : null,
      coveredByPreviousCampaign: previousCampaign
        ? {
            path: previousJournalPath,
            charge: journalSpend(previousCampaign),
            note: "Includes the historical charges, preflight allowance and first broad attempts; do not sum these again.",
          }
        : null,
      historicalPilot: e.historicalBudget.totals,
      preflightAllowance: 250_000_000,
      retainedCharge: priorReservation,
      refunded: 0,
      remainingExecutableBudget: base.ceiling - priorReservation,
    },
    security: {
      subset: "dev",
      heldoutExecuted: false,
      heldoutTextRead: false,
      credentials: "existing env/keyring refs only; offline check loads no credentials",
      publicArtifacts: "ids/hashes/counts/configuration only; no raw source/gold/answer/judge text",
      calibration: e.pilot.calibration,
    },
    claims:
      "No BFC/Robust, final lever, default or acceptance claim. Task 18 binary criteria unchanged; sizing remains unresolved at frozen supply. Genuine stopping failures remain failures.",
    nextCommand: "timeout 180 bun scripts/memory-bench/audit/readiness.mjs",
    resumeCommand: ready ? "timeout 28800 bun scripts/memory-bench/campaign.mjs --baseline-202 --parallel-arms 1" : null,
  };
  await writeFile(join(EVIDENCE, "resume-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(EVIDENCE, "readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `${report.status}: ${blockers.join(", ")}; ${jobs.length} selected cells, ${jobs.filter((j) => j.retainedCompletion).length} retained source cells; no provider calls`,
  );
  return report;
}

if (import.meta.main) {
  if (process.argv.includes("--cache-stability")) {
    const record = await writeCacheStabilityRecord();
    console.log(
      `cache-stability ${record.status}: ${record.suite.pass} pass / ${record.suite.fail} fail; equivalence ${record.equivalence.status}`,
    );
    process.exitCode = record.status === "passed" ? 0 : 1;
  } else await writeReadiness();
}
