#!/usr/bin/env bun
/** Offline prospective sizing; reads frozen id metadata and the text-free 4.5.1 audit only. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileFingerprint, PREFIX_PRODUCT_PATHS, sourceFingerprint } from "./acceptance.mjs";
import { BEAM_NORMALIZATION_VERSION } from "./datasets.mjs";
import { stableHash } from "./journal.mjs";
import { GRADED_TEMPLATE_VERSION, JUDGE_TEMPLATE_VERSION } from "./judge.mjs";
import { ROBUSTNESS_CRITERIA, robustnessCriteriaHash, robustnessDraw } from "./robustness.mjs";
import { PAIRED_ANALYSIS_VERSION, pairedAnalysis, pairedNoninferioritySizing, rubricAbilitySizing } from "./stats.mjs";

const ROOT = "docs/_evidence/memory-bench/202";

export async function pairedAnalysisProtocol(root = ".") {
  return {
    analysisVersion: PAIRED_ANALYSIS_VERSION,
    analysisHash: await fileFingerprint(
      ["scripts/memory-bench/stats.mjs", "scripts/memory-bench/paired-sizing.mjs", "scripts/memory-bench/baseline.mjs"],
      root,
    ),
    criteriaHash: robustnessCriteriaHash(),
    datasets: Object.fromEntries(
      [...ROBUSTNESS_CRITERIA.suites.inWindow, ...ROBUSTNESS_CRITERIA.suites.beyondWindow].map((suite) => {
        const draw = robustnessDraw(suite);
        return [suite, { datasetSha256: draw.datasetSha256, idsHash: draw.idsHash }];
      }),
    ),
    normalization: { version: BEAM_NORMALIZATION_VERSION, sourceHash: await fileFingerprint(["scripts/memory-bench/datasets.mjs"], root) },
    judges: {
      binaryTemplate: JUDGE_TEMPLATE_VERSION,
      gradedTemplate: GRADED_TEMPLATE_VERSION,
      sourceHash: await fileFingerprint(["scripts/memory-bench/judge.mjs", "scripts/memory-bench/judge-prompts.json"], root),
    },
    context: {
      policyVersion: 1,
      measurementVersion: "product-phases-attribution-v2",
      sourceHash: await fileFingerprint(["scripts/memory-bench/replay.mjs"], root),
    },
    pairing: "unique question ids, matching conversation clusters and abilities; incomplete comparisons have no gap",
    screening: "item-weighted paired mean; 10000 whole-cluster bootstrap draws; two-sided cluster sign-flips; seed 7",
    multiplicity:
      "Holm across all emitted overall, ability-binary and ability-graded tests in one baseline summary; pointwise CIs; descriptive only",
    acceptance: {
      metric: "frozen binary",
      margin: 0.03,
      null: "candidate - comparator <= -0.03",
      trueDiff: 0,
      alpha: 0.025,
      targetPower: 0.8,
      method: "paired-cluster-Wald-planning-approximation",
      multiplicity:
        "BFC is a conjunction: every required suite/model NI row and superiority row must pass its frozen bound; no selectable-row claims. Any subset claim needs prospective multiplicity registration.",
      warning:
        "Sizing is conditional on discordance and within-conversation paired-difference ICC; not an acceptance verdict. Normal approximation is optimistic with few clusters.",
    },
    resumption:
      "not authorized; Task 4.7 pilot and Task 4.8 readiness must freeze current models, judges, limits, product and this protocol",
  };
}

function sizesForIds(suite, ids) {
  // LongMemEval's haystack hash cannot be reconstructed from ids: each id is only an upper bound.
  if (suite === "longmemeval-m")
    return { clusterSizes: ids.map(() => 1), supply: "optimistic upper bound; verify haystack clusters before acceptance" };
  const groups = new Map();
  for (const id of ids) {
    const key = String(id).split(":")[0];
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return { clusterSizes: [...groups.values()], supply: "conversation key from frozen id metadata; no held-out text read" };
}

export async function buildPairedSizing() {
  const auditPath = `${ROOT}/graded-rubric-scoring.json`;
  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  if (audit.subset !== "dev" || !audit.diagnosticOnly) throw new Error("Sizing requires the development-only graded audit");
  const protocol = await pairedAnalysisProtocol();
  const acceptance = [];
  const supply = [];
  for (const suite of [...ROBUSTNESS_CRITERIA.suites.inWindow, ...ROBUSTNESS_CRITERIA.suites.beyondWindow]) {
    const draw = robustnessDraw(suite);
    for (const partition of ["dev", "heldout-a", "heldout-b"]) {
      const ids = Object.values(draw.abilities[partition]).flat();
      const info = sizesForIds(suite, ids);
      supply.push({ suite, partition, questions: ids.length, clusters: info.clusterSizes.length, ...info });
      if (partition !== "heldout-a" || !ROBUSTNESS_CRITERIA.suites.inWindow.includes(suite)) continue;
      for (const discordance of [0.1, 0.25, 0.5])
        for (const icc of [0, 0.5, 1]) {
          acceptance.push({ suite, partition, ...pairedNoninferioritySizing({ clusterSizes: info.clusterSizes, discordance, icc }) });
        }
    }
  }
  const rubric = [];
  for (const ability of ["event_ordering", "summarization"]) {
    const rows = audit.rejudge.filter((row) => row.ability === ability);
    const scored = (config) =>
      rows
        .filter((row) => row.config === config)
        .map((row) => ({
          id: row.id,
          cluster: `beam-${row.id.split(":")[0]}`,
          ability,
          graded: row.graded,
          correct: Object.values(row.binary).every((answer) => answer === "yes"),
        }));
    const complete = scored("complete-history"),
      oracle = scored("evidence-only (oracle)");
    const frozen = robustnessDraw("beam-100k").abilities.dev[ability];
    if (complete.length !== frozen.length || complete.some((row) => !frozen.includes(row.id)))
      throw new Error("Sizing refuses non-frozen audit ids");
    const mean = (rows, metric) => rows.reduce((sum, row) => sum + metric(row), 0) / rows.length;
    const graded = pairedAnalysis(complete, oracle, { metric: (row) => row.graded });
    const binary = pairedAnalysis(complete, oracle);
    const clusterSizes = sizesForIds(
      "beam-100k",
      complete.map((row) => row.id),
    ).clusterSizes;
    const baseline = mean(complete, (row) => row.graded),
      oracleCeiling = mean(oracle, (row) => row.graded);
    const binaryBaseline = mean(complete, (row) => Number(row.correct)),
      binaryCeiling = mean(oracle, (row) => Number(row.correct));
    rubric.push({
      ability,
      ids: complete.map((row) => row.id),
      gradedOracleComparison: graded,
      binaryOracleComparison: binary,
      ceilingScope:
        "Task 4.5.1 evidence-only diagnostic on these ids and this panel; assumed ceiling, not a population bound or candidate effect",
      primary: [0.25, 0.5, 1].map((pairedSd) => rubricAbilitySizing({ clusterSizes, baseline, oracleCeiling, pairedSd })),
      secondaryBinary: [0.1, 0.25, 0.5].map((discordance) => ({
        discordance,
        ...rubricAbilitySizing({ clusterSizes, baseline: binaryBaseline, oracleCeiling: binaryCeiling, pairedSd: Math.sqrt(discordance) }),
        estimand: "binary paired difference; SD=sqrt(discordance) at zero effect",
      })),
      multiplicity:
        "Normal MDE shown at unadjusted two-sided .05 (optimistic); Holm can only raise it. Exact sign-flip resolution already rules out discrimination.",
    });
  }
  return {
    kind: "202-paired-analysis-sizing",
    date: "2026-10-28",
    diagnosticOnly: true,
    protocol,
    protocolHash: stableHash(protocol),
    productHash: await sourceFingerprint(PREFIX_PRODUCT_PATHS),
    auditHash: await fileFingerprint([auditPath]),
    supply,
    acceptance,
    rubric,
    conclusion:
      "Task 18 3-point non-inferiority remains unresolved at the frozen supply under every declared sensitivity scenario; both audited rubric abilities are not lever-discriminating at this sample.",
    restrictions: [
      "No criteria, draws or old evidence changed",
      "No provider calls, new answers, held-out text or paid processes",
      "Repeats and extra answer models do not increase conversation supply",
      "Historical cells without analysis pins are exploratory; Task 4.8 decides reuse",
      "This is not human calibration or permission to resume",
    ],
  };
}

export function pairedSizingMarkdown(result) {
  return [
    "# Plan 202 Task 4.6: paired analysis and prospective sizing",
    "",
    result.conclusion,
    "",
    "## Registered analysis",
    "",
    result.protocol.pairing,
    result.protocol.screening,
    result.protocol.multiplicity,
    "",
    "Task 4 is descriptive screening. BEAM ordering/summarization use the registered graded primary and binary secondary. Oracle rows only inform sizing and never enter product comparisons or lever rankings. Overlapping marginal CIs are not a significance test.",
    "",
    "Task 18 keeps binary scoring and the 0.03 margin. H0: candidate minus comparator <= -0.03; alternative difference 0; one-sided alpha .025 (95% two-sided lower bound), target power .8. BFC requires all registered rows to pass (intersection-union); this does not authorize cherry-picked per-row claims. No margin or metric amendment.",
    "",
    "Sizing uses Var(paired binary difference)=q-delta² and N_eff=N²/[(1-rho)N+rho*sum(cluster_size²)]. Power is Phi((delta+.03)*sqrt(N_eff/(q-delta²))-z_.975). Required cluster supply scales the current size distribution. q=.10/.25/.50 and paired-difference ICC rho=0/.5/1 are assumptions, not fitted evidence. At one question per cluster these require 873/2181/4361 clusters respectively. These are optimistic normal planning approximations, never a universal paired sample size; few-cluster CI coverage needs verification before acceptance.",
    "",
    "## Frozen independent supply (metadata only)",
    "",
    "| Suite | Partition | Questions | Conversations | Supply qualification |",
    "| --- | --- | ---: | ---: | --- |",
    ...result.supply.map((r) => `| ${r.suite} | ${r.partition} | ${r.questions} | ${r.clusters} | ${r.supply} |`),
    "",
    "More questions, repeated answers and extra models on the same histories are not independent conversations. Partitions can share conversation keys: disjoint question ids do not imply a conversation-disjoint split. The existing draws stay frozen; this limits generalization. LongMemEval-M counts are upper bounds until its haystack hashes are checked; beyond-window rows are not the in-window NI claim.",
    "",
    "## Prospective Task 18 non-inferiority sensitivity (heldout-a)",
    "",
    "| Suite | Discordance | ICC | Effective pairs | Power | Required conversations | Status |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...result.acceptance.map(
      (r) =>
        `| ${r.suite} | ${r.discordance} | ${r.icc} | ${r.effectiveN.toFixed(2)} | ${r.power.toFixed(4)} | ${r.requiredClusters} | ${r.status} |`,
    ),
    "",
    "## Graded ability ceiling and screening resolution",
    "",
    "| Ability | Score | Baseline | Oracle ceiling | Headroom | Conversations | SD assumption | Normal MDE | Exact minimum p | Discrimination |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...result.rubric.flatMap((r) =>
      [
        ...r.primary.map((s) => ({ ...s, score: "graded primary" })),
        ...r.secondaryBinary.map((s) => ({ ...s, score: `binary secondary q=${s.discordance}` })),
      ].map(
        (s) =>
          `| ${r.ability} | ${s.score} | ${s.baseline.toFixed(4)} | ${s.oracleCeiling.toFixed(4)} | ${s.headroom.toFixed(4)} | ${s.clusters} | ${s.pairedSd.toFixed(3)} | ${s.normalApproxMde.toFixed(3)} | ${s.minimumTwoSidedP} | ${s.status} |`,
      ),
    ),
    "",
    "Normal MDE=(z_.975+z_.8)*paired_SD/sqrt(N_eff), ICC=1; SD=.25/.5/1 is sensitivity, not an estimate from four answers. With 3/4 clusters, the smallest two-sided sign-flip p is .25/.125 even for a perfect lever: **no finite detectable difference** at .05 (JSON minimumDetectableDifference=null). Holm can only reduce resolution. These abilities cannot silently open or close levers; descriptive scores and failure-stage evidence remain reportable.",
    "",
    "## Provenance and next boundary",
    "",
    `Protocol hash: ${result.protocolHash}. Criteria hash: ${result.protocol.criteriaHash}. JSON pins analysis source, dataset bytes/draws, adapter normalization, binary/graded judges, context policy and current product. New run/checkpoint fingerprints include the analysis revision and graded template; historical cells cannot be reused as current evidence.`,
    "",
    "This prospective protocol is a prerequisite, not a resumed campaign manifest. Task 4.7 must name its answer model/configuration and panel; Task 4.8 must reconcile live limits and readiness, refresh hashes and freeze the executable manifest before broad resumption. Task 4 remains unchecked.",
    "",
    "Reproduce locally: `timeout 60 bun scripts/memory-bench/paired-sizing.mjs`. Only frozen ids, counts, scores and source hashes are read; no held-out text or model calls. Existing audit is model-assisted and does not meet human calibration.",
    "",
  ].join("\n");
}

if (import.meta.main) {
  const result = await buildPairedSizing();
  await mkdir(ROOT, { recursive: true });
  await writeFile(`${ROOT}/paired-analysis-sizing.json`, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(`${ROOT}/paired-analysis-sizing.md`, pairedSizingMarkdown(result));
  console.log(result.conclusion);
}
