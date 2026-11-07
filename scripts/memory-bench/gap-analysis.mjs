#!/usr/bin/env bun
/**
 * Plan 210 Task 3: build the gap analysis from `gap-analysis-rows.mjs`.
 *
 *   bun scripts/memory-bench/gap-analysis.mjs --out     # write gap-analysis.md and gap-predictions.json
 *   bun scripts/memory-bench/gap-analysis.mjs --check   # committed files == a fresh build
 *
 * Offline; no model call. Fails if a candidate in the committed feature ledger has no row, a row names a
 * feature the ledger does not list as a candidate, or a prediction is malformed (see `predictionProblems`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFERRED, DEFERRED_VERDICTS, DEV_SUITES, REVIEW, ROWS, STRUCTURAL, VERDICTS, WHY } from "./gap-analysis-rows.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = "docs/_evidence/memory-bench/210";
export const LEDGER_PATH = `${DIR}/feature-ledger.json`;
export const MD_PATH = `${DIR}/gap-analysis.md`;
export const JSON_PATH = `${DIR}/gap-predictions.json`;

const readLedger = () => JSON.parse(readFileSync(join(ROOT, LEDGER_PATH), "utf8"));

const suiteOk = (suite) =>
  typeof suite === "string" &&
  suite.length > 0 &&
  suite.split(" + ").every((part) => part.startsWith("offline:") || DEV_SUITES.some((name) => part === `${name}/dev`));

/** Problems with one prediction entry, as strings; empty when valid. */
export function predictionProblems(entry, where) {
  const problems = [];
  if (!VERDICTS.includes(entry.verdict)) problems.push(`${where}: verdict ${entry.verdict} not in ${VERDICTS.join("|")}`);
  if (entry.verdict === "no-credible-path") {
    if (typeof entry.removal !== "string" || entry.removal.length === 0) problems.push(`${where}: no-credible-path needs a removal`);
    return problems;
  }
  for (const field of ["change", "metric", "suite", "predicted"])
    if (typeof entry[field] !== "string" || entry[field].trim().length === 0) problems.push(`${where}: ${field} missing`);
  if (entry.suite !== undefined && !suiteOk(entry.suite))
    problems.push(`${where}: suite ${entry.suite} is not a development suite or offline:`);
  if (/held-?out/i.test(`${entry.suite ?? ""}`)) problems.push(`${where}: names a held-out partition`);
  if (entry.verdict === "fix-and-measure" && (typeof entry.arm !== "string" || entry.arm.length === 0))
    problems.push(`${where}: fix-and-measure needs an arm`);
  return problems;
}

/** Validate rows against the ledger; throws with every problem listed. */
export function validate({ rows = ROWS, deferred = DEFERRED, structural = STRUCTURAL, review = REVIEW, ledger = readLedger() } = {}) {
  const problems = [];
  const candidates = new Set(ledger.features.filter((f) => f.candidate).map((f) => f.id));
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) problems.push(`${row.id}: duplicate row`);
    seen.add(row.id);
    if (!candidates.has(row.id)) problems.push(`${row.id}: not a candidate in the feature ledger`);
    if (!WHY.includes(row.why)) problems.push(`${row.id}: why ${row.why} not in vocabulary`);
    for (const field of ["intended", "source", "evidence", "gap"])
      if (typeof row[field] !== "string" || row[field].length === 0) problems.push(`${row.id}: ${field} missing`);
    problems.push(...predictionProblems(row, row.id));
    for (const variant of row.variants ?? []) {
      if (typeof variant.variant !== "string") problems.push(`${row.id}: variant without a name`);
      problems.push(...predictionProblems(variant, `${row.id}/${variant.variant}`));
    }
  }
  for (const id of candidates) if (!seen.has(id)) problems.push(`${id}: candidate has no gap-analysis row`);
  const deferredIds = new Set(deferred.map((d) => d.id));
  for (const id of ["202-task17", "202-task13"]) if (!deferredIds.has(id)) problems.push(`deferred lever ${id} missing`);
  for (const d of deferred) {
    if (!DEFERRED_VERDICTS.includes(d.disposition)) problems.push(`${d.id}: disposition ${d.disposition} not in vocabulary`);
    for (const field of ["protocol", "rule"])
      if (typeof d[field] !== "string" || d[field].length === 0) problems.push(`${d.id}: ${field} missing`);
  }
  for (const item of structural) for (const id of item.rows) if (!seen.has(id)) problems.push(`structural ${item.id}: unknown row ${id}`);
  for (const d of review.disagreements) if (!seen.has(d.id)) problems.push(`review: unknown row ${d.id}`);
  if (problems.length > 0) throw new Error(`gap analysis invalid:\n- ${problems.join("\n- ")}`);
}

const entryOf = (row, extra = {}) =>
  row.verdict === "no-credible-path"
    ? { feature: row.id, ...extra, verdict: row.verdict, why: row.why, removal: row.removal }
    : {
        feature: row.id,
        ...extra,
        verdict: row.verdict,
        why: row.why,
        change: row.change,
        metric: row.metric,
        suite: row.suite,
        predicted: row.predicted,
        ...(row.arm ? { arm: row.arm } : {}),
      };

export function buildPredictions({ rows = ROWS, deferred = DEFERRED, ledger = readLedger() } = {}) {
  validate({ rows, deferred, ledger });
  const predictions = [];
  for (const row of rows) {
    predictions.push(entryOf(row));
    for (const variant of row.variants ?? [])
      predictions.push(entryOf({ ...variant, id: row.id, why: row.why }, { variant: variant.variant }));
  }
  const count = (verdict) => rows.filter((r) => r.verdict === verdict).length;
  return {
    schemaVersion: 2,
    plan: 210,
    task: "3",
    note: "Generated by scripts/memory-bench/gap-analysis.mjs from gap-analysis-rows.mjs. One entry per candidate row plus its variants (Task 3.1's are folded in). Task 5 scores fix-and-measure and measure-elsewhere entries; no default changes before Task 6.",
    ledgerCandidates: rows.length,
    summary: {
      "fix-and-measure": count("fix-and-measure"),
      "measure-elsewhere": count("measure-elsewhere"),
      "no-credible-path": count("no-credible-path"),
    },
    predictions,
    deferred: deferred.map(({ id, title, disposition, protocol, rule }) => ({ id, title, disposition, protocol, rule })),
    review: { date: REVIEW.date, agreedBeforeResolution: REVIEW.agreedBeforeResolution, disagreements: REVIEW.disagreements.length },
  };
}

const GROUPS = [
  ["Retrieval and ranking", (id) => /^(retrieval|workers|recall)\./.test(id)],
  ["Write path", (id) => /^(write|timeline|tools)\b/.test(id)],
  ["Lifecycle", (id) => id.startsWith("lifecycle.")],
  ["Scopes", (id) => id.startsWith("scope.")],
  ["Delivery", (id) => id.startsWith("delivery.")],
  ["Decision model (202 Task 12)", (id) => id.startsWith("decisions.")],
  ["Kinds", (id) => id.startsWith("kind.") || id === "lessons"],
  ["Ontology tier", (id) => id.startsWith("ontology.")],
  ["Observational memory", (id) => id.startsWith("om.")],
  ["Presets, stores, legacy surface and navigation", () => true],
];

const predictionLine = (p) =>
  p.verdict === "no-credible-path"
    ? `- **Removal:** ${p.removal}`
    : `- **${p.verdict === "fix-and-measure" ? "Fix / arm" : "Measurement"}:** ${p.change}${p.arm ? ` (arm \`${p.arm}\`)` : ""}\n- **Prediction:** ${p.metric} on \`${p.suite}\`: ${p.predicted}`;

export function renderMarkdown({ rows = ROWS } = {}) {
  const predictions = buildPredictions({ rows });
  const s = predictions.summary;
  const out = [
    "# Plan 210 Task 3: conceptual gap analysis",
    "",
    "Generated by `scripts/memory-bench/gap-analysis.mjs` from `scripts/memory-bench/gap-analysis-rows.mjs`; do not edit by hand.",
    "Machine-readable predictions: `gap-predictions.json` (Task 5 scores them). Ids, counts and short statements only.",
    "",
    "## Summary",
    "",
    `- ${rows.length} candidates from the Task 1 ledger, all \`works\` after Task 2.`,
    `- **fix-and-measure** ${s["fix-and-measure"]}, **measure-elsewhere** ${s["measure-elsewhere"]}, **no-credible-path** ${s["no-credible-path"]} (removal candidates for Task 6; nothing is removed here).`,
    '- `why` classes: the five in the plan plus `measured-while-broken` and `never-measured` (added at execution, see the plan note). A `fix-and-measure` row whose change starts "as-is" is a plain leave-one-out or add-one with a stated prediction.',
    "- Second pass: a delegated reviewer, blind to these verdicts, agreed on " +
      `${REVIEW.agreedBeforeResolution} of ${REVIEW.candidates}; every disagreement is resolved in [Review](#second-pass-review).`,
    "",
    "| Verdict | Rows |",
    "| --- | --- |",
    ...VERDICTS.map(
      (v) =>
        `| \`${v}\` | ${rows
          .filter((r) => r.verdict === v)
          .map((r) => `\`${r.id}\``)
          .join(", ")} |`,
    ),
    "",
  ];
  const done = new Set();
  for (const [title, match] of GROUPS) {
    const members = rows.filter((r) => !done.has(r.id) && match(r.id));
    if (members.length === 0) continue;
    out.push(`## ${title}`, "");
    for (const row of members) {
      done.add(row.id);
      out.push(
        `### \`${row.id}\``,
        "",
        `- **Intended effect:** ${row.intended} (${row.source})`,
        `- **Why it did not show:** \`${row.why}\``,
        `- **Evidence:** ${row.evidence}`,
        `- **Gap:** ${row.gap}`,
        `- **Verdict:** \`${row.verdict}\``,
        predictionLine(row),
      );
      for (const v of row.variants ?? [])
        out.push(`- **Variant \`${v.variant}\`** (\`${v.verdict}\`):`, predictionLine(v).replace(/^- /gm, "  - "));
      out.push("");
    }
  }
  out.push("## Deferred levers (unbuilt, not removable rows)", "");
  for (const d of DEFERRED) {
    out.push(
      `### ${d.id}: ${d.title}`,
      "",
      `- **Disposition:** \`${d.disposition}\``,
      ...d.evidence.map((e) => `- ${e}`),
      `- **Protocol:** ${d.protocol}`,
      `- **Rule:** ${d.rule}`,
      "",
    );
  }
  out.push("## Structural findings from Task 2", "");
  for (const item of STRUCTURAL)
    out.push(
      `### ${item.id}`,
      "",
      `- **Finding:** ${item.finding}`,
      `- **Decision:** ${item.decision}`,
      `- **Rows:** ${item.rows.map((r) => `\`${r}\``).join(", ")}`,
      "",
    );
  out.push(
    "## Second-pass review",
    "",
    `Reviewer: ${REVIEW.reviewer}, ${REVIEW.date}. Verdicts agreed on ${REVIEW.agreedBeforeResolution} of ${REVIEW.candidates} before resolution.`,
    "",
    `Label rule: ${REVIEW.labelRule}`,
    "",
    "| Row | Kind | Resolution |",
    "| --- | --- | --- |",
    ...REVIEW.disagreements.map((d) => `| \`${d.id}\` | ${d.kind} | ${d.resolution.replaceAll("|", "/")} |`),
    "",
    "Reviewer findings adopted:",
    "",
    ...REVIEW.findingsAdopted.map((f) => `- ${f}`),
    "",
    "Not adopted (recorded for Task 4):",
    "",
    ...REVIEW.notAdopted.map((f) => `- ${f}`),
    "",
  );
  return out.join("\n");
}

const jsonText = () => `${JSON.stringify(buildPredictions(), null, 2)}\n`;

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--out")) {
    writeFileSync(join(ROOT, JSON_PATH), jsonText());
    writeFileSync(join(ROOT, MD_PATH), renderMarkdown());
    console.log(JSON.stringify(buildPredictions().summary));
  } else if (args.includes("--check")) {
    const stale = [
      [JSON_PATH, jsonText()],
      [MD_PATH, renderMarkdown()],
    ].filter(([path, text]) => readFileSync(join(ROOT, path), "utf8") !== text);
    if (stale.length > 0) {
      console.error(`stale: ${stale.map(([p]) => p).join(", ")}; run with --out`);
      process.exit(1);
    }
    console.log("current");
  } else {
    validate();
    console.log(JSON.stringify(buildPredictions().summary));
  }
}
