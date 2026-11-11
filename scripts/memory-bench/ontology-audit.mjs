#!/usr/bin/env bun
/**
 * Plan 208 Task 2: the claim-support audit, the false-generalization metric for model-written concepts.
 *
 * A sampled claim is judged for entailment by the notes it cites, nothing else. The panel is plan 199's
 * `createJudgePanel` (distinct-model judges, majority, a tie falls to the lower score); each judge sees the
 * citations in a different order (forward, then reversed) so position bias does not decide a label. A
 * 60-claim human set calibrates the panel. Reports carry ids, labels, counts and rates, never text.
 *
 * Input is a claim bundle per history (`ontology-claims-v1`), written by the ontology arm into
 * `<campaign>/ontology-claims/<arm>/*.json`. Bundles are private working data like the answer cache; they
 * hold claim and note text and are never published.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { calibrateJudge, cohensKappa, createJudgePanel } from "@arnilo/prism-hosts/evals";
import { parseConceptBody } from "@arnilo/prism-knowledge/wiki";
import {
  CLAIM_LABELS,
  drawStratified,
  HUMAN_AUDIT_CLAIMS,
  parseClaimLabels,
  renderClaimReviewPage,
  selectHumanAuditClaims,
} from "./audit/claim-review.mjs";
import { stableHash } from "./journal.mjs";
import { judgeFamily, resolveJudgePanel } from "./judge.mjs";
import { THREE_TIER_CRITERIA, threeTierCriteriaHash, verifyThreeTierCriteria } from "./robustness.mjs";

export const CLAIM_BUNDLE_KIND = "ontology-claims-v1";
export const CLAIM_REPORT_KIND = "ontology-claim-support-v1";
export const MAX_CLAIMS_PER_GROUP = THREE_TIER_CRITERIA.criteria.O3.sample.maxClaimsPerArmAndModel;
export const SUPPORT_SCORE = Object.freeze({ supported: 1, "partially-supported": 0.5, unsupported: 0, contradicted: 0 });

export const CLAIM_SUPPORT_TEMPLATE = [
  "You are checking whether a memory claim is supported by the notes it cites.",
  "Judge only from the cited notes below. Do not use outside knowledge and do not assume anything they do not say.",
  "Labels:",
  "- supported: every part of the claim follows from the cited notes taken together.",
  "- partially-supported: some of the claim follows from them; some part goes beyond them.",
  "- unsupported: the cited notes do not establish the claim.",
  "- contradicted: a cited note says the opposite.",
  "Also list the numbers of the cited notes the claim actually needed.",
  "",
  "Claim: {claim}",
  "",
  "Cited notes:",
  "{notes}",
].join("\n");
export const CLAIM_SUPPORT_INSTRUCTION =
  'Reply with only a JSON object: {"label": "<supported|partially-supported|unsupported|contradicted>", "needed": [<note numbers>]}';
export const CLAIM_SUPPORT_TEMPLATE_VERSION = stableHash({ CLAIM_SUPPORT_TEMPLATE, CLAIM_SUPPORT_INSTRUCTION });

const SIZE_BUCKETS = [
  ["small", 3],
  ["medium", 9],
  ["large", Number.POSITIVE_INFINITY],
];
export const sizeBucket = (claims) => SIZE_BUCKETS.find(([, max]) => claims <= max)[0];

/** Build a bundle from concept file bodies and a note-text lookup; the ontology arm calls this per history. */
export function bundleFromConcepts({ arm, model, suite, partition, history, concepts, noteText, questions }) {
  const notes = {};
  const out = concepts.map(({ id, subject, scope, text }) => {
    const doc = parseConceptBody(text, { allowUncited: true });
    for (const claim of doc.claims)
      for (const cite of claim.cites) {
        const note = noteText(cite);
        if (typeof note === "string") notes[cite] = note;
      }
    return {
      id,
      subject,
      scope,
      claims: doc.claims.map((claim) => ({
        id: claim.id,
        text: claim.text,
        cites: [...claim.cites],
        ...(claim.human ? { human: true } : {}),
      })),
    };
  });
  return { kind: CLAIM_BUNDLE_KIND, arm, model, suite, partition, history, concepts: out, notes, ...(questions ? { questions } : {}) };
}

export async function loadClaimBundles(dir) {
  const bundles = [];
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    const bundle = JSON.parse(await readFile(join(dir, name), "utf8"));
    if (bundle?.kind !== CLAIM_BUNDLE_KIND) throw new Error(`MemoryBenchAudit: ${name} is not an ${CLAIM_BUNDLE_KIND} bundle`);
    bundles.push(bundle);
  }
  if (!bundles.length) throw new Error("MemoryBenchAudit: no claim bundles found");
  return bundles;
}

/** Model-written, cited claims only; a human claim is the person's, not the curator's. */
export function flattenClaims(bundles) {
  const claims = [];
  const counts = { human: 0, uncited: 0 };
  for (const bundle of bundles)
    for (const concept of bundle.concepts) {
      const size = sizeBucket(concept.claims.length);
      for (const claim of concept.claims) {
        if (claim.human) {
          counts.human++;
          continue;
        }
        if (!claim.cites?.length) {
          counts.uncited++;
          continue;
        }
        claims.push({
          id: `${bundle.arm}|${bundle.model}|${bundle.history}|${concept.id}|${claim.id}`,
          group: `${bundle.arm}|${bundle.model}`,
          arm: bundle.arm,
          model: bundle.model,
          suite: bundle.suite,
          partition: bundle.partition,
          size,
          stratum: `${bundle.suite}:${size}`,
          text: claim.text,
          cites: claim.cites,
          notes: claim.cites.map((cite) => bundle.notes?.[cite]),
        });
      }
    }
  return { claims, ...counts };
}

/** Citation order shown to a judge: the first judge sees file order, the next the reverse, and so on. */
export const citationOrder = (count, reverse) => {
  const order = Array.from({ length: count }, (_, index) => index);
  return reverse ? order.reverse() : order;
};

export function claimPrompt(claim, order) {
  const notes = order.map((index, position) => `[${position + 1}] ${claim.notes[index]}`).join("\n\n");
  return CLAIM_SUPPORT_TEMPLATE.replace("{claim}", () => claim.text).replace("{notes}", () => notes);
}

export function parseClaimVerdict(text, count) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let value;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("MemoryBenchJudgeError: invalid claim-support verdict JSON");
  }
  if (!value || !CLAIM_LABELS.includes(value.label)) throw new Error("MemoryBenchJudgeError: invalid claim-support label");
  const needed = value.needed ?? [];
  if (!Array.isArray(needed) || needed.some((n) => !Number.isSafeInteger(n) || n < 1 || n > count))
    throw new Error("MemoryBenchJudgeError: invalid needed-note list");
  return { label: value.label, needed: [...new Set(needed)] };
}

/**
 * One panel member. `generate(prompt, { parse, instruction })` is the bench's judge callback (askJudge
 * applies `parse` to the reply text). Which cited notes the judge called needed goes to `neededLog`,
 * because the panel keeps only labels and scores.
 */
export function createClaimJudge({ id, model, generate, reverse = false, neededLog }) {
  return {
    id,
    judgeModel: model,
    async score(input) {
      const claim = input.item?.input;
      const order = citationOrder(claim.notes.length, reverse);
      const redact = (value) => (input.redactor ? input.redactor.redact(value) : value);
      const verdict = await generate(redact(claimPrompt(claim, order)), {
        parse: (text) => parseClaimVerdict(text, order.length),
        instruction: CLAIM_SUPPORT_INSTRUCTION,
      });
      const needed = verdict.needed.map((position) => order[position - 1]);
      neededLog?.get(input.item.id)?.set(id, needed);
      return { score: SUPPORT_SCORE[verdict.label], metadata: { label: verdict.label } };
    },
  };
}

/** Build the plan 199 panel from `[ { ref: "provider/model", generate } ]`; judge i reverses citations when i is odd. */
export function createClaimPanel({ judges, neededLog }) {
  return createJudgePanel({
    id: "ontology-claim-support",
    combine: "majority",
    judges: judges.map(({ ref, generate }, index) => {
      const slash = ref.indexOf("/");
      return createClaimJudge({
        id: ref,
        model: { provider: ref.slice(0, slash), model: ref.slice(slash + 1) },
        generate,
        reverse: index % 2 === 1,
        neededLog,
      });
    }),
  });
}

/** Ordered results with bounded parallelism (`judge.mjs`'s `mapLimit` discards them). */
async function mapOrdered(items, limit, run) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        out[index] = await run(items[index]);
      }
    }),
  );
  return out;
}

const dummyResult = Object.freeze({ sessionId: "audit", runId: "audit", status: "completed", text: "", content: [], messages: [] });

function wilsonLow(successes, n, z = 1.96) {
  if (!n) return null;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
}

/**
 * Judge claims through the panel. A claim whose cited note is missing from the bundle cannot be shown
 * verbatim, so it is `unsupported` without a call. A panel that loses quorum records `failed`, which
 * counts against the claim: an unjudged claim is never rounded up to supported.
 */
export async function judgeClaims(claims, { panel, neededLog, concurrency = 4, cache = new Map(), signal } = {}) {
  return mapOrdered(claims, concurrency, async (claim) => {
    const base = {
      id: claim.id,
      group: claim.group,
      suite: claim.suite,
      partition: claim.partition,
      size: claim.size,
      cited: claim.cites.length,
    };
    if (claim.notes.some((note) => typeof note !== "string")) return { ...base, label: "unsupported", judged: false, unresolved: true };
    if (cache.has(claim.id)) return cache.get(claim.id);
    neededLog?.set(claim.id, new Map());
    let row;
    try {
      const result = await panel.score({
        item: { id: claim.id, input: { claim: claim.text, notes: claim.notes, text: claim.text } },
        result: dummyResult,
        signal,
      });
      const perJudge = neededLog?.get(claim.id) ?? new Map();
      const verdicts = result.metadata.labels.filter(Boolean).length;
      const votes = new Map();
      for (const needed of perJudge.values()) for (const index of needed) votes.set(index, (votes.get(index) ?? 0) + 1);
      const neededCount = [...votes.values()].filter((count) => count * 2 > Math.max(verdicts, 1)).length;
      row = { ...base, label: result.metadata.label, judged: true, labels: result.metadata.labels, neededCount };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      row = { ...base, label: "unsupported", judged: false, failed: true };
    }
    cache.set(claim.id, row);
    return row;
  });
}

/** Share of answer-bearing notes reachable from the citations of the concepts recalled for correctly answered questions. */
export function evidenceReach(bundles) {
  let answered = 0;
  let reached = 0;
  for (const bundle of bundles) {
    const citesOf = new Map(bundle.concepts.map((concept) => [concept.id, new Set(concept.claims.flatMap((claim) => claim.cites ?? []))]));
    for (const question of bundle.questions ?? []) {
      if (!question.correct || !question.answerBearing?.length) continue;
      answered++;
      const reachable = new Set((question.recalled ?? []).flatMap((id) => [...(citesOf.get(id) ?? [])]));
      if (question.answerBearing.some((note) => reachable.has(note))) reached++;
    }
  }
  return { answered, reached, share: answered ? reached / answered : null };
}

export function summarizeGroup(rows) {
  const labels = Object.fromEntries(CLAIM_LABELS.map((label) => [label, rows.filter((row) => row.label === label).length]));
  const supportedRows = rows.filter((row) => row.label === "supported" && row.judged);
  const cited = supportedRows.reduce((sum, row) => sum + row.cited, 0);
  const needed = supportedRows.reduce((sum, row) => sum + row.neededCount, 0);
  return {
    sampled: rows.length,
    judged: rows.filter((row) => row.judged).length,
    failed: rows.filter((row) => row.failed).length,
    unresolved: rows.filter((row) => row.unresolved).length,
    labels,
    supportedShare: rows.length ? labels.supported / rows.length : null,
    supportedShareWilsonLow: wilsonLow(labels.supported, rows.length),
    citationPrecision: cited ? needed / cited : null,
    byStratum: Object.fromEntries(
      [...new Set(rows.map((row) => `${row.suite}:${row.size}`))].sort().map((stratum) => {
        const part = rows.filter((row) => `${row.suite}:${row.size}` === stratum);
        return [stratum, { sampled: part.length, supported: part.filter((row) => row.label === "supported").length }];
      }),
    ),
  };
}

/**
 * Panel against the human set. Only `supported` counts toward O3, so the governing agreement is
 * supported-versus-not; the four-label kappa is reported beside it. Reuses the plan 199 calibration report.
 */
export async function calibratePanel({ rows, humanLabels, seed = 7 }) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pairs = humanLabels.filter((label) => byId.has(label.id) && byId.get(label.id).judged);
  const binary = (label) => (label === "supported" ? 1 : 0);
  const items = pairs.map((label) => ({
    item: { id: label.id, input: null, expected: label.verdict },
    result: dummyResult,
    humanScore: binary(label.verdict),
  }));
  const view = { id: "panel-supported-view", score: async ({ item }) => ({ score: binary(byId.get(item.id).label) }) };
  const report = await calibrateJudge({ judge: view, items, seed });
  const four = cohensKappa(
    pairs.map((label) => CLAIM_LABELS.indexOf(label.verdict)),
    pairs.map((label) => CLAIM_LABELS.indexOf(byId.get(label.id).label)),
  );
  return {
    n: report.n,
    labelled: humanLabels.length,
    unmatched: humanLabels.length - pairs.length,
    kappaSupportedVsNot: report.cohensKappa,
    kappaCi95: report.kappaCi95 ?? null,
    kappaFourLabel: four ?? null,
    krippendorffAlpha: report.krippendorffAlpha,
    confusion: report.confusion,
  };
}

/** O3 row. Invalid, not failed, when the panel is not calibrated: an uncalibrated judge proves nothing. */
export function o3Row({ groups, calibration, criteria = THREE_TIER_CRITERIA.criteria.O3 }) {
  const kappa = calibration?.kappaSupportedVsNot ?? null;
  const reasons = [];
  if (kappa === null || kappa < criteria.panelHumanKappaAtLeast) reasons.push("panel-human kappa below threshold or missing");
  if ((calibration?.n ?? 0) < criteria.humanAuditSet.claims) reasons.push("human audit set incomplete");
  const valid = reasons.length === 0;
  const perGroup = Object.fromEntries(
    Object.entries(groups).map(([group, summary]) => [
      group,
      { supportedShare: summary.supportedShare, pass: valid ? summary.supportedShare >= criteria.supportedShareAtLeast : null },
    ]),
  );
  return {
    valid,
    invalidReasons: reasons,
    kappa,
    threshold: criteria.supportedShareAtLeast,
    pass: valid ? Object.values(perGroup).every((row) => row.pass) : null,
    groups: perGroup,
  };
}

/** Reports hold ids, labels and counts. Any claim or note text found in one is a hard error. */
export function assertReportHasNoText(report, bundles) {
  const body = JSON.stringify(report);
  for (const bundle of bundles) {
    const texts = [...Object.values(bundle.notes ?? {}), ...bundle.concepts.flatMap((c) => c.claims.map((claim) => claim.text))];
    for (const text of texts)
      if (typeof text === "string" && text.trim().length >= 12 && body.includes(text))
        throw new Error("MemoryBenchAudit: a report would carry claim or note text");
  }
}

/** The whole audit for one arm. `judges` is `[ { ref, generate } ]`; the sample is seeded and per (arm, model). */
export async function runAudit({
  bundles,
  arm,
  judges,
  sample = MAX_CLAIMS_PER_GROUP,
  seed = "prism-208-claim-audit",
  humanLabels,
  humanIds,
  concurrency = 4,
  signal,
}) {
  verifyThreeTierCriteria();
  if (!Number.isSafeInteger(sample) || sample < 1 || sample > MAX_CLAIMS_PER_GROUP)
    throw new Error(`MemoryBenchArguments: --sample must be 1 to ${MAX_CLAIMS_PER_GROUP}`);
  const scoped = bundles.filter((bundle) => bundle.arm === arm);
  if (!scoped.length) throw new Error(`MemoryBenchAudit: no bundles for arm ${arm}`);
  const { claims, human, uncited } = flattenClaims(scoped);
  const forcedIds = new Set(humanIds ?? humanLabels?.map((label) => label.id) ?? []);
  const neededLog = new Map();
  const panel = createClaimPanel({ judges, neededLog });
  const cache = new Map();
  const grouped = Map.groupBy(claims, (claim) => claim.group);
  const rows = [];
  for (const [group, pool] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const picked = drawStratified(pool, {
      n: Math.min(sample, pool.length),
      seed: `${seed}:${group}`,
      forced: pool.filter((claim) => forcedIds.has(claim.id)),
    });
    rows.push(...(await judgeClaims(picked, { panel, neededLog, concurrency, cache, signal })));
  }
  const groups = Object.fromEntries(
    [...grouped.keys()].sort().map((group) => [group, summarizeGroup(rows.filter((row) => row.group === group))]),
  );
  const calibration = humanLabels ? await calibratePanel({ rows, humanLabels }) : null;
  const report = {
    kind: CLAIM_REPORT_KIND,
    plan: 208,
    arm,
    criteriaHash: threeTierCriteriaHash(),
    templateVersion: CLAIM_SUPPORT_TEMPLATE_VERSION,
    seed,
    sample,
    panel: judges.map(({ ref }, index) => ({ ref, family: judgeFamily(ref), citationOrder: index % 2 ? "reversed" : "forward" })),
    pool: { claims: claims.length, humanClaimsExcluded: human, uncitedExcluded: uncited },
    judgeCalls: rows.filter((row) => row.judged).length * judges.length,
    groups,
    evidenceReach: evidenceReach(scoped),
    calibration,
    o3: calibration ? o3Row({ groups, calibration }) : { valid: false, invalidReasons: ["no human labels"], pass: null },
    rows: rows.map(({ id, group, suite, size, label, judged, failed, unresolved, cited, neededCount, labels }) => ({
      id,
      group,
      suite,
      size,
      label,
      judged,
      ...(failed ? { failed } : {}),
      ...(unresolved ? { unresolved } : {}),
      cited,
      neededCount,
      labels,
    })),
  };
  assertReportHasNoText(report, scoped);
  return report;
}

/** Deterministic offline fixture: two models, two suites, a held-out bundle and a human claim; scripted judges. */
export function offlineFixture() {
  const bundles = [];
  for (const model of ["mock/curator-a", "mock/curator-b"])
    for (const [suite, partition] of [
      ["locomo", "dev"],
      ["beam-100k", "dev"],
      ["locomo", "heldout-a"],
    ]) {
      const concepts = [2, 5, 11].map((count, c) => ({
        id: `concept-${c + 1}`,
        subject: `subject-${c + 1}`,
        scope: "project",
        claims: Array.from({ length: count }, (_, k) => {
          const n = `${model}/${suite}/${partition}/${c + 1}/${k + 1}`;
          return {
            id: `c${k + 1}`,
            text: `fixture claim ${createHash("sha256").update(n).digest("hex").slice(0, 8)}`,
            cites: [`${c}${k}a000000000`.slice(0, 12), `${c}${k}b000000000`.slice(0, 12)],
            ...(k === 1 && c === 0 ? { human: true } : {}),
          };
        }),
      }));
      const notes = {};
      for (const concept of concepts)
        for (const claim of concept.claims) {
          notes[claim.cites[0]] = `evidence for ${claim.text}`;
          notes[claim.cites[1]] = `filler unrelated to ${claim.text}`;
        }
      bundles.push({
        kind: CLAIM_BUNDLE_KIND,
        arm: "conversational+O",
        model,
        suite,
        partition,
        history: `${suite}-${partition}`,
        concepts,
        notes,
      });
    }
  return bundles;
}

const scriptedLabel = (text) => {
  const digit = Number.parseInt(createHash("sha256").update(text).digest("hex")[0], 16);
  return digit < 12 ? "supported" : digit < 14 ? "partially-supported" : digit < 15 ? "unsupported" : "contradicted";
};
/** Scripted judges for the offline run: a, b and c agree except b softens one label in eight. */
export function scriptedJudges() {
  const make = (ref, soften) => ({
    ref,
    generate: async (prompt, { parse }) => {
      const text = /^Claim: (.*)$/m.exec(prompt)[1];
      let label = scriptedLabel(text);
      if (soften && label === "supported" && Number.parseInt(createHash("sha256").update(`b${text}`).digest("hex")[0], 16) < 2)
        label = "partially-supported";
      const needed = [...prompt.matchAll(/^\[(\d+)\] (.*)$/gm)].filter((m) => !m[2].startsWith("filler")).map((m) => Number(m[1]));
      return parse(JSON.stringify({ label, needed }));
    },
  });
  return [make("mock/judge-a", false), make("mock/judge-b", true), make("mock/judge-c", false)];
}

/** Offline stand-in for the person: agrees with the scripted label, except one claim in ten. */
export function offlineHumanLabels(bundles, arm = "conversational+O") {
  const { claims } = flattenClaims(bundles.filter((bundle) => bundle.arm === arm && bundle.partition === "dev"));
  return selectHumanAuditClaims(claims).map((claim, index) => ({
    id: claim.id,
    verdict: index % 10 === 9 ? "unsupported" : scriptedLabel(claim.text),
  }));
}

/** The model behind a ref, route-free: `kilo/x/m:free` and `openrouter/x/m:free` are the same model. */
const curatorModelKey = (ref) =>
  String(ref ?? "")
    .split("/")
    .slice(1)
    .join("/")
    .replace(/:free$/, "")
    .toLowerCase();

/**
 * A judge may not score claims its own model curated, through any route, in any bundle of the arm. Returns the
 * resolved panel; throws before any judge call.
 */
export function assertNoCuratorJudge({ refs, bundles }) {
  const panel = resolveJudgePanel({ judges: refs });
  const curators = new Set(bundles.map((bundle) => curatorModelKey(bundle.model)));
  for (const ref of panel.refs)
    if (curators.has(curatorModelKey(ref)))
      throw new Error(`MemoryBenchJudgePanel: ${ref} curated claims in this arm and cannot judge them`);
  return panel;
}

/**
 * The gates that authorize a live claim audit: plan 208's O-1, and plan 210's C-1 (Task 5 opens with the panel
 * calibration that moved there from Task 3.2). Anything else, or an unapproved record, is refused.
 */
export const CLAIM_AUDIT_GATES = Object.freeze([
  { plan: 208, gate: "O-1" },
  { plan: 210, gate: "C-1" },
]);
export function assertClaimAuditGate(approval) {
  const known = CLAIM_AUDIT_GATES.some((entry) => entry.plan === approval?.plan && entry.gate === approval?.gate);
  if (!known || approval.approved !== true || approval.approvedBy !== "owner")
    throw new Error("MemoryBenchGate: live claim audit needs an approved gate O-1 (plan 208) or C-1 (plan 210) record (--gate)");
  return approval;
}

async function liveJudges({ refs, bundles, calls, gate }) {
  assertClaimAuditGate(JSON.parse(await readFile(gate, "utf8").catch(() => "null")));
  const panel = assertNoCuratorJudge({ refs, bundles });
  return openClaimJudges({ refs: panel.refs, calls });
}

/**
 * The live claim panel without a gate check: the caller verifies its own gate first (plan 208 O-1 above, plan 209
 * W-1 in `work-outcome/live.mjs`). `calls` bounds the wire attempts and tokens; the panel accounts its own usage.
 */
export async function openClaimJudges({ refs, calls, root = ".cache/memory-bench/audit/208-claims", freeOnly = false }) {
  const panel = resolveJudgePanel({ judges: refs });
  const { createAgent } = await import("@arnilo/prism");
  const { providerPackage } = await import("@arnilo/prism/provider-kit");
  const { openDiagnostic } = await import("./audit/zero-score.mjs");
  const { askJudge, refOf } = await import("./run.mjs");
  const limits = { wireAttempts: calls * 3, inputTokens: calls * 8_000, outputTokens: calls * 1_500, wallMs: 14_400_000, retries429: 4 };
  const session = await openDiagnostic({ root, refs: panel.refs, limits, freeOnly });
  const agents = new Map();
  for (const ref of panel.refs)
    agents.set(
      ref,
      await createAgent({
        model: { ...session.live.models.get(ref), parameters: { temperature: 0, maxTokens: 1024 } },
        compaction: false,
        retry: false,
        packages: [
          providerPackage(
            `claim-audit-${refOf(ref)
              .model.replaceAll(/[^a-zA-Z0-9-]/g, "-")
              .toLowerCase()}`,
            session.live.providers,
          ),
        ],
        limits: { maxTurns: 1, maxInputTokens: null, maxTotalTokens: null, maxWallTimeMs: 180_000 },
      }),
    );
  const counters = { judge: 0, judgeAttempts: 0 };
  return {
    judges: panel.refs.map((ref) => ({
      ref,
      generate: (prompt, options) =>
        askJudge({
          agent: agents.get(ref),
          prompt,
          ...options,
          account: session.account,
          ceilingReached: session.ceilingReached,
          calls: counters,
          timeoutMs: 300_000,
        }),
    })),
    usage: () => session.usage?.() ?? null,
    close: async () => {
      for (const agent of agents.values()) await agent.dispose();
      session.close();
    },
  };
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        offline: { type: "boolean" },
        campaign: { type: "string" },
        arm: { type: "string" },
        sample: { type: "string" },
        judges: { type: "string" },
        labels: { type: "string" },
        gate: { type: "string" },
        seed: { type: "string" },
        output: { type: "string" },
        "build-human-set": { type: "string" },
      },
      strict: true,
    });
    const sample = values.sample === undefined ? MAX_CLAIMS_PER_GROUP : Number(values.sample);
    let bundles;
    let judges;
    let close;
    const arm = values.arm ?? "conversational+O";
    if (values.offline) {
      bundles = offlineFixture();
      judges = scriptedJudges();
    } else {
      if (!values.campaign) throw new Error("MemoryBenchArguments: --campaign or --offline is required");
      bundles = await loadClaimBundles(join(values.campaign, "ontology-claims", arm));
    }
    const humanLabels = values.labels
      ? parseClaimLabels(await readFile(values.labels, "utf8"))
      : values.offline
        ? offlineHumanLabels(bundles, arm)
        : undefined;
    if (values["build-human-set"]) {
      const { claims } = flattenClaims(bundles.filter((bundle) => bundle.arm === arm && bundle.partition === "dev"));
      const picked = selectHumanAuditClaims(claims, { n: HUMAN_AUDIT_CLAIMS });
      const out = values["build-human-set"];
      await mkdir(out, { recursive: true, mode: 0o700 });
      await writeFile(join(out, "review.html"), renderClaimReviewPage(picked.map((c) => ({ id: c.id, claim: c.text, notes: c.notes }))), {
        mode: 0o600,
      });
      await writeFile(
        join(out, "ids.json"),
        `${JSON.stringify(
          picked.map((c) => c.id),
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
      console.log(`wrote ${picked.length} claims to ${out}/review.html`);
      process.exit(0);
    }
    if (!judges) {
      const calls = bundles.length * Math.min(sample, MAX_CLAIMS_PER_GROUP) * 3;
      ({ judges, close } = await liveJudges({ refs: values.judges, bundles, calls, gate: values.gate }));
    }
    try {
      const report = await runAudit({ bundles, arm, judges, sample, seed: values.seed, humanLabels });
      const text = `${JSON.stringify(report, null, 2)}\n`;
      if (values.output) {
        await mkdir(dirname(values.output), { recursive: true });
        await writeFile(values.output, text, { mode: 0o600 });
      }
      for (const [group, summary] of Object.entries(report.groups))
        console.log(
          `${group}: sampled=${summary.sampled} supported=${summary.supportedShare?.toFixed(3)} precision=${summary.citationPrecision?.toFixed(3)}`,
        );
      console.log(`O3 valid=${report.o3.valid} pass=${report.o3.pass} judgeCalls=${report.judgeCalls}`);
    } finally {
      await close?.();
    }
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
