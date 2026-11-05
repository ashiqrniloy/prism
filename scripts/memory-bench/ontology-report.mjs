/**
 * Plan 208 Task 5: the development report per criterion (`acceptance-report.mjs --plan 208 --partition dev`).
 *
 * It reads the screen's run reports, the claim-support audit reports and the ontology safety report, and gives one
 * row per criterion of `three-tier-criteria.json` (O1-O7; O8 waits for plan 209 Task 6). Development numbers are
 * advisory, never the verdict, and the report says so on every row. Ids, counts, rates and scores only: no question,
 * gold, note or claim text.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertScreen208Partition, SCREEN208_EVIDENCE, SCREEN208_PAIRED_MODELS, SCREEN208_SERIES_MODEL, SCREEN208_SUITES } from "./ontology-screen.mjs";
import { THREE_TIER_CRITERIA, threeTierCriteriaHash } from "./robustness.mjs";
import { pairedAnalysis } from "./stats.mjs";

const CRITERIA = THREE_TIER_CRITERIA.criteria;
const SENSITIVE = THREE_TIER_CRITERIA.abilities.consolidationSensitive;
const rate = (n, d) => (d ? n / d : null);
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const points = (value) => (value === null || value === undefined ? null : Math.round(value * 1000) / 10);

/** The latest attempt's report for a job id: `run-208-task5-<id>.json`, or `-<n>` for a later attempt. */
export async function loadScreenReports(dir = SCREEN208_EVIDENCE) {
  const reports = new Map();
  if (!existsSync(dir)) return reports;
  const prefix = "run-208-task5-";
  const files = (await readdir(dir)).filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
  for (const name of files) {
    const report = JSON.parse(await readFile(join(dir, name), "utf8"));
    const stem = name.slice(prefix.length, -".json".length);
    const match = stem.match(/^(.*?)(?:-(\d+))?$/);
    // A job id ends in a suite name, so a trailing `-<n>` is the attempt number.
    const id = /-\d+$/.test(stem) && !/\.\d+$/.test(stem) ? match[1] : stem;
    const attempt = id === stem ? 1 : Number(match[2]);
    const previous = reports.get(id);
    if (!previous || attempt > previous.attempt) reports.set(id, { id, attempt, report });
  }
  return new Map([...reports].map(([id, value]) => [id, value.report]));
}

const scored = (report) =>
  (report?.results ?? []).filter((row) => typeof row.correct === "boolean" || row.correct === 0 || row.correct === 1);

/** Paired rows of two reports for one suite, with ids and clusters made unique across suites. */
function pair(baseReport, otherReport, suite) {
  const other = new Map(scored(otherReport).map((row) => [row.id, row]));
  const rows = scored(baseReport).filter((row) => other.has(row.id));
  const tag = (row) => ({
    id: `${suite}:${row.id}`,
    cluster: `${suite}:${row.cluster ?? row.id}`,
    ability: row.ability,
    correct: row.correct,
  });
  return {
    a: rows.map(tag),
    b: rows.map((row) => tag(other.get(row.id))),
    unpaired: scored(baseReport).length + scored(otherReport).length - 2 * rows.length,
  };
}

function analysis(a, b) {
  if (!a.length) return { n: 0, diff: null, ci95: [null, null], p: null, clusters: 0 };
  const result = pairedAnalysis(a, b, { iterations: 4000 });
  return {
    n: result.n,
    clusters: result.clusters,
    diff: result.diff,
    ci95: result.ci95,
    p: result.p,
    wins: result.wins,
    losses: result.losses,
  };
}

/** O1, O2, O7 and the per-ability table for one answer model's `P` against `P+O`. */
export function pairedCriteria({ reports, model, baseArm = "P", otherArm = "P+O" }) {
  const sensitive = { a: [], b: [] };
  const other = { a: [], b: [] };
  let unpaired = 0;
  const suites = [];
  for (const suite of SCREEN208_SUITES) {
    const base = reports.get(`208-screen.${model.key}.${baseArm}.${suite}`);
    const twin = reports.get(`208-screen.${model.key}.${otherArm}.${suite}`);
    if (!base || !twin) continue;
    const paired = pair(base, twin, suite);
    unpaired += paired.unpaired;
    suites.push(suite);
    const names = new Set(SENSITIVE[suite] ?? []);
    paired.a.forEach((row, index) => {
      const bucket = names.has(row.ability) ? sensitive : other;
      bucket.a.push(row);
      bucket.b.push(paired.b[index]);
    });
  }
  const all = { a: [...sensitive.a, ...other.a], b: [...sensitive.b, ...other.b] };
  const byAbility = {};
  for (const ability of [...new Set(all.a.map((row) => `${row.id.split(":")[0]}:${row.ability}`))].sort()) {
    const keep = (row) => `${row.id.split(":")[0]}:${row.ability}` === ability;
    const a = all.a.filter(keep);
    byAbility[ability] = analysis(
      a,
      all.b.filter((_, index) => keep(all.a[index])),
    );
  }
  return {
    suites,
    unpairedDropped: unpaired,
    sensitive: analysis(sensitive.a, sensitive.b),
    other: analysis(other.a, other.b),
    byAbility,
    accuracy: { base: mean(all.a.map((row) => Number(row.correct))), other: mean(all.b.map((row) => Number(row.correct))) },
  };
}

export function o1Row(perModel) {
  const rows = perModel.map(({ model, paired }) => ({
    model: model.model,
    n: paired.sensitive.n,
    diffPoints: points(paired.sensitive.diff),
    ciLowPoints: points(paired.sensitive.ci95[0]),
    pass: paired.sensitive.n > 0 && paired.sensitive.diff > 0 && paired.sensitive.ci95[0] > 0,
  }));
  const passing = rows.filter((row) => row.pass).length;
  // O1 needs two passing models from two providers: count the providers of the passing models, not of the panel.
  const providerOf = new Map(SCREEN208_PAIRED_MODELS.map((model) => [model.model, model.provider]));
  const providersPassing = new Set(rows.filter((row) => row.pass).map((row) => providerOf.get(row.model) ?? row.model)).size;
  const providers = new Set(SCREEN208_PAIRED_MODELS.map((model) => model.provider)).size;
  return {
    criterion: "O1",
    name: CRITERIA.O1.name,
    models: rows,
    modelsPassing: passing,
    providersPassing,
    needs: { models: CRITERIA.O1.minAnswerModels, providers: CRITERIA.O1.minProviders },
    pass: rows.every((row) => row.n === 0) ? null : passing >= CRITERIA.O1.minAnswerModels && providersPassing >= CRITERIA.O1.minProviders,
    // A development screen is advisory in any case; it says so here when the panel itself cannot meet the rule.
    note: providers < CRITERIA.O1.minProviders ? "advisory: one provider serves every model" : undefined,
  };
}

export function o2Row(perModel) {
  const margin = CRITERIA.O2.pooledOther.nonInferiorityPoints / 100;
  const floor = CRITERIA.O2.perAbility.maxBelowPPointsAtCiLow / 100;
  const rows = perModel.map(({ model, paired }) => {
    const abilities = Object.entries(paired.byAbility).map(([ability, row]) => ({
      ability,
      n: row.n,
      diffPoints: points(row.diff),
      ciLowPoints: points(row.ci95[0]),
      // An ability fails when the CI lower bound is more than 5 points below `P`.
      pass: row.n === 0 || row.ci95[0] >= -floor,
    }));
    return {
      model: model.model,
      pooledOther: {
        n: paired.other.n,
        diffPoints: points(paired.other.diff),
        ciLowPoints: points(paired.other.ci95[0]),
        pass: paired.other.n === 0 ? null : paired.other.ci95[0] >= -margin,
      },
      abilities,
      abilitiesBelowFloor: abilities.filter((row) => !row.pass).map((row) => row.ability),
    };
  });
  return {
    criterion: "O2",
    name: CRITERIA.O2.name,
    models: rows,
    pass: rows.every((row) => row.pooledOther.n === 0)
      ? null
      : rows.every((row) => row.pooledOther.pass !== false && row.abilitiesBelowFloor.length === 0),
  };
}

/** O5: curator cost per 1k archived exchanges (cold/warm are priced only on a priced route; free reports tokens). */
export function o5Row({ reports, perModelNames }) {
  const rows = [];
  for (const model of perModelNames) {
    let curatorCalls = 0;
    let curatorInput = 0;
    let curatorOutput = 0;
    let exchanges = 0;
    let baseInput = 0;
    let baseQuestions = 0;
    let twinInput = 0;
    let twinQuestions = 0;
    for (const suite of SCREEN208_SUITES) {
      const base = reports.get(`208-screen.${model.key}.P.${suite}`);
      const twin = reports.get(`208-screen.${model.key}.P+O.${suite}`);
      if (!base || !twin) continue;
      baseInput += base.roleUsage?.product?.inputTokens ?? 0;
      baseQuestions += scored(base).length;
      twinInput += twin.roleUsage?.product?.inputTokens ?? 0;
      twinQuestions += scored(twin).length;
      curatorCalls += twin.ontologySummary?.curator?.calls ?? 0;
      curatorInput += twin.ontologySummary?.curator?.inputTokens ?? 0;
      curatorOutput += twin.ontologySummary?.curator?.outputTokens ?? 0;
      exchanges += scored(twin).reduce((n, row) => n + (row.ingest?.archived ?? 0), 0);
    }
    const perQuestionBase = rate(baseInput, baseQuestions);
    const perQuestionTwin = rate(twinInput, twinQuestions);
    const ratio = perQuestionBase ? perQuestionTwin / perQuestionBase : null;
    rows.push({
      model: model.model,
      curatorCallsPer1kExchanges: exchanges ? (curatorCalls / exchanges) * 1000 : null,
      curatorInputTokensPer1kExchanges: exchanges ? (curatorInput / exchanges) * 1000 : null,
      curatorOutputTokensPer1kExchanges: exchanges ? (curatorOutput / exchanges) * 1000 : null,
      answerInputTokensPerQuestion: { base: perQuestionBase, withOntology: perQuestionTwin, ratio },
      answerRatioPass: ratio === null ? null : ratio <= CRITERIA.O5.answerInputTokensPerQuestionRatioAtMost,
      pricing: "free route: tokens reported, USD 0; cold/warm cost applies on a priced route (plan 210)",
    });
  }
  return {
    criterion: "O5",
    name: CRITERIA.O5?.name ?? "cost",
    models: rows,
    pass:
      rows.length > 0 && rows.every((row) => row.answerRatioPass !== false) && rows.some((row) => row.answerRatioPass !== null)
        ? true
        : rows.some((row) => row.answerRatioPass === false)
          ? false
          : null,
  };
}

export function o3Summary(audits, { humanLabelSource = "person" } = {}) {
  const rows = audits.map((audit) => ({
    arm: audit.arm,
    valid: audit.o3?.valid ?? false,
    pass: audit.o3?.pass ?? null,
    kappa: audit.o3?.kappa ?? null,
    invalidReasons: audit.o3?.invalidReasons ?? [],
    supportedShare: audit.groups
      ? mean(
          Object.values(audit.groups)
            .map((group) => group.supportedShare)
            .filter((v) => typeof v === "number"),
        )
      : null,
  }));
  return {
    criterion: "O3",
    name: CRITERIA.O3.name,
    arms: rows,
    // Who labelled the audit set. "person" is what the criteria require; anything else is a recorded deviation.
    humanLabelSource,
    humanLabelDeviation:
      humanLabelSource === "person" ? null : "panel-versus-assistant agreement, not panel-versus-human; plan 210 repeats O3 with a person",
    // Invalid is not failed: an uncalibrated panel proves nothing either way.
    pass: rows.length && rows.every((row) => row.valid) ? rows.every((row) => row.pass) : null,
    status: rows.length === 0 ? "not-run" : rows.every((row) => row.valid) ? "valid" : "invalid-until-human-set-labelled",
  };
}

export function o4Row(safety) {
  if (!safety) return { criterion: "O4", name: CRITERIA.O4?.name ?? "safety", pass: null, status: "not-run" };
  return {
    criterion: "O4",
    name: CRITERIA.O4?.name ?? "safety",
    pass: safety.o4?.pass ?? null,
    status: safety.o4?.status ?? safety.o4?.pass,
    probes: safety.o4?.checks ?? null,
    counts: safety.o4?.counts ?? null,
    plan202Gate: safety.verdict?.status ?? safety.verdict?.pass ?? null,
    evasiveResidual: safety.ontology?.poisoning?.evasiveResidual ?? safety.ontology?.evasiveResidual ?? null,
    evasiveResidualPanelVerdict: "pending: judged by the claim-audit panel at the first live audit run",
  };
}

/** O7: the small model's `P+O` is never below `P` by more than 5 points on any ability (point estimate). */
export function o7Row(perModel) {
  const small = perModel.find(({ model }) => model.small);
  if (!small) return { criterion: "O7", pass: null, status: "no small model" };
  const floor = CRITERIA.O7.maxBelowPPointsOnAnyAbility;
  const below = Object.entries(small.paired.byAbility)
    .filter(([, row]) => row.diff !== null && row.diff < -floor / 100)
    .map(([ability, row]) => ({ ability, diffPoints: points(row.diff) }));
  return {
    criterion: "O7",
    name: CRITERIA.O7?.name ?? "small model",
    model: small.model.model,
    abilitiesBelow: below,
    pass: small.paired.sensitive.n + small.paired.other.n === 0 ? null : below.length === 0,
  };
}

/** The trigger-policy comparison: read-time only against the three default policies, same warm-up and scored sets. */
export function triggerPolicyRow({ reports, audits, model = SCREEN208_SERIES_MODEL }) {
  const margin = THREE_TIER_CRITERIA.arms.triggerPolicies.nonInferiorityPoints / 100;
  const a = [];
  const b = [];
  const cost = { default: { calls: 0, input: 0, exchanges: 0 }, readTime: { calls: 0, input: 0, exchanges: 0 } };
  for (const suite of SCREEN208_SUITES) {
    const full = reports.get(`208-screen.${model.key}.P+O.series-default.${suite}`);
    const cheap = reports.get(`208-screen.${model.key}.P+O.series-readtime.${suite}`);
    if (!full || !cheap) continue;
    const paired = pair(full, cheap, suite);
    a.push(...paired.a);
    b.push(...paired.b);
    for (const [key, report] of [
      ["default", full],
      ["readTime", cheap],
    ]) {
      cost[key].calls += report.ontologySummary?.curator?.calls ?? 0;
      cost[key].input += report.ontologySummary?.curator?.inputTokens ?? 0;
      cost[key].exchanges += scored(report).reduce((n, row) => n + (row.ingest?.archived ?? 0), 0);
    }
  }
  const diff = analysis(a, b);
  const per1k = (value) => ({
    callsPer1kExchanges: value.exchanges ? (value.calls / value.exchanges) * 1000 : null,
    inputTokensPer1kExchanges: value.exchanges ? (value.input / value.exchanges) * 1000 : null,
  });
  const support = (arm) => audits.find((audit) => audit.arm === `${arm}.${model.key}`)?.o3 ?? null;
  const nonInferior = diff.n === 0 ? null : diff.ci95[0] >= -margin;
  const cheaper =
    cost.readTime.calls !== undefined && cost.default.exchanges && cost.readTime.exchanges
      ? cost.readTime.calls / cost.readTime.exchanges < cost.default.calls / cost.default.exchanges
      : null;
  return {
    comparison: "read-time only (co-read + repair) minus the three default policies",
    model: model.model,
    n: diff.n,
    diffPoints: points(diff.diff),
    ciLowPoints: points(diff.ci95[0]),
    nonInferiorityPoints: margin * 100,
    nonInferior: nonInferior,
    cost: { default: per1k(cost.default), readTime: per1k(cost.readTime) },
    claimSupport: { default: support("P+O.series-default"), readTime: support("P+O.series-readtime") },
    // Task 5 may change the default to the cheaper policy only when the two are non-inferior to each other.
    mayAdoptReadTimeOnly: nonInferior === true && cheaper === true,
    loserForPlan210: nonInferior === true && cheaper === true ? "three default policies" : nonInferior === false ? "read-time only" : null,
  };
}

/** The `concept` failure-stage column for every ontology arm. */
export function conceptStageTable(reports) {
  const table = {};
  for (const [id, report] of reports) {
    if (!report.ontologySummary) continue;
    table[id] = report.ontologySummary.conceptStages?.all ?? null;
  }
  return table;
}

/** Features without a passing development row: candidates for plan 210's ledger. */
export function ledgerCandidates({ rows, policy, o3, o4 }) {
  const failed = [];
  const add = (feature, reason) => failed.push({ feature, reason });
  if (rows.O3.pass !== true) add("the tier as a whole", `O3 ${rows.O3.status}`);
  if (rows.O4.pass !== true) add("the tier as a whole", `O4 ${rows.O4.status ?? "not passing"}`);
  if (policy.nonInferior === false) add("read-time only trigger policy", "inferior to the three default policies");
  if (policy.nonInferior === true && policy.mayAdoptReadTimeOnly === false)
    add("trigger policy: the extra triggers", "no accuracy gain over read-time only");
  if (policy.nonInferior === null) add("each trigger policy", "no paired series result");
  add("concept prior", "no ablation arm in the development screen");
  add("passive pointer", "no ablation arm in the development screen");
  add("concept sharing", "not exercised by the development screen");
  add("extractor-assisted binding", "not exercised by the development screen");
  add("coding+O (O6)", "not screened: no coding preset or sandbox on a free route");
  void o3;
  void o4;
  return failed;
}

export async function buildOntologyDevReport({
  partition = "dev",
  evidence = SCREEN208_EVIDENCE,
  auditDir = `${SCREEN208_EVIDENCE}/audit`,
  safetyPath = "docs/_evidence/memory-bench/208/safety/safety.json",
} = {}) {
  assertScreen208Partition(partition);
  const reports = await loadScreenReports(evidence);
  const audits = [];
  if (existsSync(auditDir))
    for (const name of (await readdir(auditDir)).filter((file) => file.endsWith(".json")))
      audits.push(JSON.parse(await readFile(join(auditDir, name), "utf8")));
  const gatePath = "docs/_evidence/memory-bench/208/gates/owner-gate-1.json";
  const gate = existsSync(gatePath) ? JSON.parse(await readFile(gatePath, "utf8")) : null;
  const delegated = gate?.amendments?.some((item) => /labelled by the assistant/.test(item.effect ?? ""));
  const humanLabelSource = delegated ? "assistant (owner-delegated 2026-11-03)" : "person";
  const safety = existsSync(safetyPath) ? JSON.parse(await readFile(safetyPath, "utf8")) : null;
  const perModel = SCREEN208_PAIRED_MODELS.map((model) => ({ model, paired: pairedCriteria({ reports, model }) }));
  const rows = {
    O1: o1Row(perModel),
    O2: o2Row(perModel),
    O3: o3Summary(audits, { humanLabelSource }),
    O4: o4Row(safety),
    O5: o5Row({ reports, perModelNames: SCREEN208_PAIRED_MODELS }),
    O6: { criterion: "O6", pass: null, status: "not-screened: no coding preset or sandbox on a free route; ledger candidate for plan 210" },
    O7: o7Row(perModel),
    O8: { criterion: "O8", pass: null, status: "waits for plan 209 Task 6" },
  };
  const policy = triggerPolicyRow({ reports, audits });
  return {
    schemaVersion: 1,
    kind: "208-development-report",
    plan: 208,
    task: 5,
    partition,
    advisory: "development numbers are never the verdict; the held-out read is plan 210 Task 9",
    threeTierCriteriaHash: threeTierCriteriaHash(),
    jobsRead: reports.size,
    rows,
    triggerPolicy: policy,
    conceptStages: conceptStageTable(reports),
    ledger: ledgerCandidates({ rows, policy }),
    noText: true,
  };
}

export function renderOntologyDevReport(report) {
  const status = (row) => (row.pass === true ? "pass" : row.pass === false ? "fail" : (row.status ?? "pending"));
  return [
    `# Plan 208 Task 5 — development report (${report.partition}, advisory)`,
    "",
    report.advisory,
    "",
    `Criteria hash \`${report.threeTierCriteriaHash}\`; ${report.jobsRead} run reports read.`,
    "",
    "| Criterion | Status |",
    "| --- | --- |",
    ...Object.values(report.rows).map((row) => `| ${row.criterion}${row.name ? ` ${row.name}` : ""} | ${status(row)} |`),
    "",
    "## Trigger policy",
    "",
    `Read-time only minus default policies: ${report.triggerPolicy.diffPoints ?? "n/a"} points (CI low ${report.triggerPolicy.ciLowPoints ?? "n/a"}), n=${report.triggerPolicy.n}; non-inferior: ${report.triggerPolicy.nonInferior ?? "n/a"}.`,
    "",
    "## Ledger candidates for plan 210",
    "",
    ...report.ledger.map((item) => `- ${item.feature}: ${item.reason}`),
    "",
  ].join("\n");
}

export async function writeOntologyDevReport(options = {}) {
  const report = await buildOntologyDevReport(options);
  const dir = options.out ?? SCREEN208_EVIDENCE;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "development-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(dir, "development-report.md"), renderOntologyDevReport(report));
  return report;
}
