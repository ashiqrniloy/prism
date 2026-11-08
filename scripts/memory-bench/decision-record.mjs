/**
 * Plan 210 Task 6: the decision record.
 *
 * `docs/_evidence/memory-bench/210/decisions.{json,md}` is generated from the feature ledger (Task 1), the gap
 * predictions (Task 3), the pre-registered criteria (Task 4), the wave-1 report (Task 5) and the owner's notes
 * (`owner-decisions.json`). Every verdict is `cleanupVerdict()`'s: the owner supplies holds and their written reasons,
 * never a verdict. The record carries ids, labels, counts, rates and scores, and no question, note or corpus text.
 *
 *   timeout 120 bun scripts/memory-bench/decision-record.mjs            # write decisions.json and decisions.md
 *   timeout 120 bun scripts/memory-bench/decision-record.mjs --check    # the committed files equal a fresh build
 */
import { readFileSync, writeFileSync } from "node:fs";
import { assertCleanupCriteriaPin, CLEANUP_CRITERIA, cleanupVerdict, verifyCleanupCriteria } from "./robustness.mjs";

const EVIDENCE = "docs/_evidence/memory-bench/210";
export const DECISIONS_JSON = `${EVIDENCE}/decisions.json`;
export const DECISIONS_MD = `${EVIDENCE}/decisions.md`;
export const OWNER_DECISIONS = `${EVIDENCE}/owner-decisions.json`;
const root = new URL("../../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

const CANCEL_NOTE = "unmeasured: its arms were in a wave gate C-1 cancelled on 2026-11-08";
const fmt = (value) => (value === null || value === undefined ? "n/a" : String(value));

/** Why a candidate that has no wave-1 verdict is not decided: the one place the `unmeasured` reasons are chosen. */
function unmeasuredReason(row, predictions) {
  if (row.cancelled?.length) return { kind: "wave-cancelled", text: CANCEL_NOTE, arms: row.cancelled.map((item) => item.arm) };
  const kinds = new Set(predictions.filter((item) => item.feature === row.feature).map((item) => item.verdict));
  const offline = predictions.find((item) => item.feature === row.feature && /exchange-tier-off/.test(item.arm ?? ""));
  if (offline)
    return {
      kind: "offline-only",
      text: "unmeasured by a model run: only the offline growth stream measured it (210/offline/growth-*); its p95 half is not measured",
    };
  if (kinds.has("measure-elsewhere"))
    return { kind: "measure-elsewhere", text: "unmeasured: Task 3 assigned it to an instrument outside this campaign (gap-analysis.md)" };
  return { kind: "no-arm", text: "unmeasured: no wave-1 arm exercises it" };
}

/** The effect lines of one measured feature: points with the feature on, with CI, per answer model and suite. */
function effectLines(row, oriented) {
  const lines = [];
  for (const arm of row.arms ?? [])
    for (const [model, byArm] of Object.entries(oriented ?? {}))
      for (const [suite, effect] of Object.entries(byArm[arm] ?? {}))
        lines.push({
          arm,
          model,
          suite,
          n: effect.n,
          points: effect.pointsWithFeature,
          ci95: effect.ci95Points,
          negativeStrata: Object.entries(effect.abilities)
            .filter(([, ability]) => ability.ci95Points[1] < 0)
            .map(([ability, value]) => ({ ability, n: value.n, ci95: value.ci95Points })),
        });
  return lines;
}

function task5Summary(report, feature) {
  const rows = (report.plan202Task5?.rows ?? []).filter((item) => item.feature === feature);
  if (!rows.length) return null;
  const count = (verdict) => rows.filter((item) => item.candidateGap?.verdict === verdict).length;
  return {
    cells: rows.length,
    pass: report.plan202Task5.pass[feature] === true,
    candidateGap: { pass: count("pass"), miss: count("miss"), inconclusive: count("inconclusive") },
    unverified: rows.filter((item) => item.status === "unverified").length,
    vetoed: rows.filter((item) => item.vetoed).length,
  };
}

/**
 * Builds the record. Pure: every input is passed in. `owner` holds the owner's notes:
 * `holds` (feature -> written reason), `inertApproval`, `beamContradictionPrompt` and `unmeasuredPolicy`.
 */
export function buildDecisionRecord({ ledger, report, predictions, criteria = CLEANUP_CRITERIA, owner }) {
  assertCleanupCriteriaPin(report, verifyCleanupCriteria(criteria));
  const verdictOf = new Map(report.verdicts.map((row) => [row.feature, row]));
  const transferred = new Map(criteria.transferred.features.map((row) => [row.feature, row]));
  const inert = new Set(criteria.inertRemoval.features);
  const conditional = new Set(criteria.inertRemoval.conditional.features);
  const holds = owner.holds ?? {};
  const predictionRows = predictions.predictions;

  for (const id of Object.keys(holds))
    if (!verdictOf.get(id)?.measured) throw new Error(`DecisionRecord: owner hold on ${id}, which has no wave-1 verdict`);
  const decided = [];
  const features = [];
  for (const row of ledger.features) {
    const base = { feature: row.id, group: row.group, ledgerStatus: row.status, candidate: row.candidate === true };
    const transfer = transferred.get(row.id);
    if (transfer) {
      features.push({ ...base, section: "transferred", verdict: "transferred", plan: transfer.plan, reason: transfer.reason });
      continue;
    }
    if (!row.candidate) {
      features.push({
        ...base,
        section: "accepted",
        verdict: "keep",
        reason: `ledger status ${row.status}: accepted evidence, not re-decided`,
      });
      continue;
    }
    const measured = verdictOf.get(row.id);
    if (measured?.measured) {
      const hold = holds[row.id];
      if (hold && measured.verdict === "remove" && measured.reason === "negative")
        throw new Error(`DecisionRecord: owner hold on ${row.id} does not apply to a negative verdict`);
      const verdict = cleanupVerdict({ ...measured.evidence, ownerHold: hold ? { reason: hold } : null }, criteria);
      const entry = {
        ...base,
        section: "measured",
        computed: measured.verdict,
        computedReason: measured.reason,
        verdict: verdict.verdict,
        tier: verdict.tier,
        reason: verdict.reason,
        arms: measured.arms,
        cells: measured.cells,
        effects: effectLines(measured, report.oriented),
        predictions: report.predictions.filter((item) => item.feature === row.id).map(({ arm, outcome }) => ({ arm, outcome })),
        plan202Task5: task5Summary(report, row.id),
        ...(hold ? { ownerHold: hold } : {}),
      };
      features.push(entry);
      decided.push(entry);
      continue;
    }
    if (inert.has(row.id) || conditional.has(row.id)) {
      // Non-inferiority by the byte-identical-preset test, which Task 7 builds with the removal.
      const verdict = cleanupVerdict({ feature: row.id, status: row.status, removal: { inert: true, byteIdentical: true } }, criteria);
      const entry = {
        ...base,
        section: "inert-removal",
        verdict: verdict.verdict,
        tier: verdict.tier,
        reason: verdict.reason,
        conditional: conditional.has(row.id),
        condition: conditional.has(row.id)
          ? "Task 7 byte-identical-preset test; a failure waits for a paid arm (none is open: gate C-1 is closed), so the owner decides then"
          : "Task 7 byte-identical-preset test on the conversational and coding presets",
        approvedBy: owner.inertApproval,
      };
      features.push(entry);
      decided.push(entry);
      continue;
    }
    const why = unmeasuredReason(measured ?? { feature: row.id }, predictionRows);
    features.push({
      ...base,
      section: "unmeasured",
      verdict: "unmeasured",
      reason: why.text,
      unmeasuredKind: why.kind,
      ...(why.arms ? { cancelledArms: why.arms } : {}),
      stays: row.presets?.conversational === "member" || row.presets?.coding === "member" ? "on (preset member)" : "at its current default",
    });
  }

  const count = (section) => features.filter((item) => item.section === section).length;
  const removals = features.filter((item) => item.verdict === "remove").map((item) => item.feature);
  const experimental = features.filter((item) => item.tier === "experimental").map((item) => item.feature);
  return {
    kind: "210-decision-record",
    plan: 210,
    task: 6,
    criteriaHash: report.criteriaHash,
    cleanupCriteriaHash: report.cleanupCriteriaHash,
    reportManifestHash: report.manifestHash,
    productHash: report.productHash,
    partition: report.partition,
    note: "Development evidence only. Every verdict is cleanupVerdict()'s; the owner supplies holds and written reasons, never a verdict.",
    owner: {
      decided: owner.decided,
      by: owner.by,
      inertApproval: owner.inertApproval,
      negativeOverrides: criteria.ownerNegativeOverrides,
      beamContradictionPrompt: owner.beamContradictionPrompt,
      unmeasuredPolicy: owner.unmeasuredPolicy,
    },
    totals: {
      ledgerRows: features.length,
      measured: count("measured"),
      inertRemoval: count("inert-removal"),
      transferred: count("transferred"),
      unmeasured: count("unmeasured"),
      accepted: count("accepted"),
    },
    removals,
    experimental,
    plan202Task5: ["write.keyword-enrichment", "navigation.agentic-lexical"].map((feature) => ({
      feature,
      ...task5Summary(report, feature),
    })),
    plan202Closure: report.plan202Closure,
    f4: { disposition: report.f4.disposition, moved: report.f4.moved },
    features,
  };
}

const row = (cells) => `| ${cells.join(" | ")} |`;
const code = (id) => `\`${id}\``;

export function renderDecisionMarkdown(record) {
  const by = (section) => record.features.filter((item) => item.section === section);
  const out = [];
  const push = (...lines) => out.push(...lines);
  push(
    "# Plan 210 Task 6: decision record",
    "",
    "Generated by `scripts/memory-bench/decision-record.mjs` from the feature ledger, the gap predictions, the pre-registered criteria, the wave-1 report and `owner-decisions.json`. Do not edit by hand. Ids, labels, counts and scores only: no question, note or corpus text.",
    "",
    `- Cleanup criteria hash: \`${record.cleanupCriteriaHash}\``,
    `- Robustness criteria hash: \`${record.criteriaHash}\``,
    `- C-1 manifest hash: \`${record.reportManifestHash}\`; product hash \`${record.productHash}\``,
    `- Partition: ${record.partition} only. Gate C-1 closed after wave 1 (amendment 7); waves 2 and 3 were cancelled.`,
    `- Owner review: ${record.owner.decided} (${record.owner.by}).`,
    "",
    "## Summary",
    "",
    row(["Section", "Rows"]),
    row(["---", "---:"]),
    row(["Measured in wave 1 (computed by `cleanupVerdict()`)", record.totals.measured]),
    row(["Inert removals (byte-identical-preset test pending, Task 7)", record.totals.inertRemoval]),
    row(["Transferred to plans 216-221", record.totals.transferred]),
    row(["Unmeasured, not removed", record.totals.unmeasured]),
    row(["Accepted evidence, not re-decided", record.totals.accepted]),
    "",
    "## Removals (the list Task 7 executes)",
    "",
    ...record.removals.map((id) => `- ${code(id)}`),
    "",
    "## Experimental tier (owner holds)",
    "",
    ...(record.experimental.length ? record.experimental.map((id) => `- ${code(id)}`) : ["None."]),
    "",
    "## Measured in wave 1",
    "",
    "`verdict` is the final one: the computed verdict, then the owner's hold if any. `retrieval.lexical` is kept under an owner negative override (below). Predictions are Task 3's, scored once.",
    "",
    row(["Feature", "Computed", "Final", "Tier", "Why", "Prediction"]),
    row(["---", "---", "---", "---", "---", "---"]),
  );
  for (const item of by("measured"))
    push(
      row([
        code(item.feature),
        item.computed,
        `**${item.verdict}**`,
        item.tier,
        item.ownerHold ? `owner hold: ${item.computedReason}` : item.reason,
        item.predictions.map((value) => `${value.arm}: ${value.outcome}`).join("; ") || "n/a",
      ]),
    );
  for (const item of by("measured")) {
    push(
      "",
      `### ${code(item.feature)}`,
      "",
      `Arms: ${item.arms.map(code).join(", ")}. Cells: ${item.cells}. Points are with the feature on, minus off; CI is 95%, clustered.`,
      "",
    );
    push(
      row(["Model", "Suite", "n", "Points", "95% CI", "Strata with CI wholly below 0"]),
      row(["---", "---", "---:", "---:", "---", "---"]),
    );
    for (const effect of item.effects)
      push(
        row([
          effect.model,
          effect.suite,
          effect.n,
          effect.points,
          `[${effect.ci95.join(", ")}]`,
          effect.negativeStrata.map((value) => `${value.ability} (n=${value.n}, [${value.ci95.join(", ")}])`).join("; ") || "none",
        ]),
      );
    if (item.plan202Task5)
      push(
        "",
        `Plan 202 Task 5 rules (frozen): ${item.plan202Task5.pass ? "pass" : "**miss**"} over ${item.plan202Task5.cells} suite x model cells. Candidate-gap halving: ${item.plan202Task5.candidateGap.pass} pass, ${item.plan202Task5.candidateGap.miss} miss, ${item.plan202Task5.candidateGap.inconclusive} inconclusive; ability veto fired in ${item.plan202Task5.vetoed}; ${item.plan202Task5.unverified} unverified.`,
      );
    if (item.ownerHold) push("", `**Owner hold (experimental tier).** ${item.ownerHold}`);
  }
  push(
    "",
    "## Inert removals",
    "",
    `Approved by the owner on ${record.owner.decided}: ${record.owner.inertApproval}`,
    "",
    "The non-inferiority rule is met by the byte-identical-preset test, which Task 7 builds with each removal. The verdict is `remove` on that condition.",
    "",
    row(["Feature", "Verdict", "Condition"]),
    row(["---", "---", "---"]),
    ...by("inert-removal").map((item) =>
      row([code(item.feature), `**${item.verdict}**${item.conditional ? " (conditional)" : ""}`, item.condition]),
    ),
    "",
    "## Transferred rows",
    "",
    "Not kept, fixed or removed here. Each destination plan writes its final disposition, and none is scored as a miss.",
    "",
    row(["Feature", "Verdict", "Destination", "Reason"]),
    row(["---", "---", "---", "---"]),
    ...by("transferred").map((item) => row([code(item.feature), "transferred", `plan ${item.plan}`, item.reason])),
    "",
    "## Unmeasured, not removed",
    "",
    `${record.owner.unmeasuredPolicy}`,
    "",
    "No removal is proposed for these rows, so they are not the `inconclusive` of Task 4's rules. Opt-in variants stay opt-in; default-on features stay on. Plan 223 Task 3 lists them as unmeasured, with no claim.",
    "",
    row(["Feature", "Why", "Stays"]),
    row(["---", "---", "---"]),
    ...by("unmeasured").map((item) => row([code(item.feature), item.reason, item.stays])),
    "",
    "## Plan 202 closure rows",
    "",
    row(["Source task", "Row", "Status", "Features"]),
    row(["---:", "---", "---", "---"]),
    ...record.plan202Closure.map((item) => row([item.sourceTask, item.title, item.status, item.features.map(code).join(", ") || "none"])),
    "",
    "`unverified` rows were not measured by wave 1: waves 2 and 3 were cancelled, or another instrument measures them. Plan 223's held-out acceptance still scores `robustness-criteria.json` in full.",
    "",
    "## Owner decisions",
    "",
    `- **Negative override.** ${record.owner.negativeOverrides.map((item) => `${code(item.feature)}: ${item.reason}`).join(" ")}`,
    `- **Inert removals.** ${record.owner.inertApproval}`,
    `- **BEAM contradiction resolution (Task 3.1 hand-off).** ${record.owner.beamContradictionPrompt.decision}`,
    `- **F4 and the conditional Task 17 arm.** ${fmt(record.f4.disposition)}; ${record.f4.moved}.`,
    "",
  );
  return `${out.join("\n")}\n`;
}

/**
 * The structural checks the record must pass: every ledger row exactly once; a transferred row carries no keep or remove
 * verdict and names a destination plan; a hold names a written reason and the experimental tier, and is never on a
 * negative verdict; an unmeasured row is neither removed nor moved to the experimental tier.
 */
export function assertDecisionRecord(record, { ledger, criteria = CLEANUP_CRITERIA }) {
  const fail = (message) => {
    throw new Error(`DecisionRecord: ${message}`);
  };
  const ids = record.features.map((item) => item.feature);
  if (new Set(ids).size !== ids.length) fail("a ledger row appears twice");
  if (ids.length !== ledger.features.length || ledger.features.some((row) => !ids.includes(row.id)))
    fail("the record does not cover the ledger");
  const transferred = new Map(criteria.transferred.features.map((row) => [row.feature, row.plan]));
  for (const item of record.features) {
    if (transferred.has(item.feature)) {
      if (item.verdict !== "transferred" || item.section !== "transferred")
        fail(`${item.feature} is transferred but carries verdict ${item.verdict}`);
      if (item.plan !== transferred.get(item.feature) || !Number.isInteger(item.plan)) fail(`${item.feature} lacks its destination plan`);
    } else if (item.verdict === "transferred") fail(`${item.feature} is marked transferred but is not in the criteria's list`);
    if (item.verdict === "owner-hold") {
      if (item.tier !== "experimental") fail(`${item.feature} is held outside the experimental tier`);
      if (typeof item.ownerHold !== "string" || !item.ownerHold.trim()) fail(`${item.feature} is held without a written reason`);
      if (item.computed === "remove" && item.computedReason === "negative")
        fail(`${item.feature} is a negative verdict and cannot be held`);
    }
    if (item.section === "unmeasured" && (item.verdict !== "unmeasured" || item.tier || record.removals.includes(item.feature)))
      fail(`${item.feature} is unmeasured and must not be removed or held`);
  }
  for (const id of record.removals)
    if (!record.features.find((item) => item.feature === id && item.verdict === "remove")) fail(`removal ${id} has no remove verdict`);
  return record;
}

function main() {
  const ledger = readJson(`${EVIDENCE}/feature-ledger.json`);
  const report = readJson(`${EVIDENCE}/ablations/c1-report.json`);
  const predictions = readJson(`${EVIDENCE}/gap-predictions.json`);
  const owner = readJson(OWNER_DECISIONS);
  const record = assertDecisionRecord(buildDecisionRecord({ ledger, report, predictions, owner }), { ledger });
  const json = `${JSON.stringify(record, null, 2)}\n`;
  const markdown = renderDecisionMarkdown(record);
  if (process.argv.includes("--check")) {
    const same =
      readFileSync(new URL(DECISIONS_JSON, root), "utf8") === json && readFileSync(new URL(DECISIONS_MD, root), "utf8") === markdown;
    if (!same) {
      console.error("DecisionRecord: the committed decisions.{json,md} differ from a fresh build");
      process.exitCode = 1;
    } else console.log("decision record matches a fresh build");
    return;
  }
  writeFileSync(new URL(DECISIONS_JSON, root), json);
  writeFileSync(new URL(DECISIONS_MD, root), markdown);
  console.log(JSON.stringify({ ...record.totals, removals: record.removals.length, experimental: record.experimental.length }));
}

if (import.meta.main) main();
