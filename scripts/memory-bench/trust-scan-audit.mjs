/**
 * Plan 188.11 Task 8: measure the exchange archive's gates offline. Every user/assistant exchange in
 * the pinned LongMemEval-S and LoCoMo files is passed through the trust scan and an agent
 * `SecretRedactor` exactly as `packages/memory/fabric/src/exchanges.ts` does, and a small adversarial
 * fixture measures detection recall per refused class. No model call is made and no corpus text is
 * written: the report holds ids, counts, rates and classes only.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createSecretRedactor } from "@arnilo/prism";
import { scanScopedMemoryContent } from "../../packages/memory/fabric/src/scoped/trust.ts";
import { loadDataset, normalizeDataset } from "./datasets.mjs";

export const TRUST_SCAN_CLASSES = ["prompt-injection", "exfil", "invisible-unicode", "secret"];
export const EVIDENCE_DIR = "docs/_evidence/memory-bench/188.11";
const FIXTURE = "scripts/memory-bench/fixtures/injection-corpus.json";
const THRESHOLD_PER_1000 = 1;

function refusal(text, redactor) {
  const scan = scanScopedMemoryContent(text);
  if (!scan.ok) return scan.class;
  if (redactor.redact(text) !== text) return "secret";
  return undefined;
}

/** Every completed exchange in one normalized session, labelled the way the archive stores it. */
function sessionExchanges(session) {
  const pairs = [];
  let user;
  for (const message of session.messages) {
    if (message.role === "user") {
      if (message.text.length > 0) user = message;
      continue;
    }
    if (user !== undefined && typeof message.text === "string" && message.text.length > 0) pairs.push({ user, assistant: message });
  }
  return pairs;
}

function emptyCounts() {
  return { scanned: 0, refused: 0, byClass: Object.fromEntries(TRUST_SCAN_CLASSES.map((name) => [name, 0])) };
}

function rate(value, total) {
  return total === 0 ? 0 : Number(((value / total) * 1000).toFixed(3));
}

/**
 * Audit one suite's normalized questions. Exchanges are counted once per session id (the cleaned
 * LongMemEval file repeats some sessions across questions), and a needed-session loss is a question
 * whose `answerSessionIds` (ids only) names a session holding at least one refused exchange.
 */
export function auditQuestions(questions, redactor) {
  const counts = emptyCounts();
  const seenExchanges = new Set();
  const refusedSessions = new Map();
  let neededQuestions = 0;
  let touchedNeeded = 0;
  for (const question of questions) {
    const needed = new Set(question.answerSessionIds ?? []);
    if (needed.size > 0) neededQuestions += 1;
    let touched = false;
    for (const session of question.sessions) {
      let refused = refusedSessions.get(session.id);
      if (refused === undefined) {
        refused = false;
        for (const pair of sessionExchanges(session)) {
          const key = `${session.id}\0${pair.user.id}\0${pair.assistant.id}`;
          if (seenExchanges.has(key)) continue;
          seenExchanges.add(key);
          counts.scanned += 1;
          const failure = refusal(`user: ${pair.user.text}\n\nassistant: ${pair.assistant.text}`, redactor);
          if (failure === undefined) continue;
          refused = true;
          counts.refused += 1;
          counts.byClass[failure] += 1;
        }
        refusedSessions.set(session.id, refused);
      }
      if (refused && needed.has(session.id)) touched = true;
    }
    if (touched) touchedNeeded += 1;
  }
  return {
    questions: questions.length,
    neededQuestions,
    neededSessionRefusedQuestions: touchedNeeded,
    exchanges: counts.scanned,
    refusedExchanges: counts.refused,
    refusedPer1000: rate(counts.refused, counts.scanned),
    refusedByClass: counts.byClass,
    refusedByClassPer1000: Object.fromEntries(Object.entries(counts.byClass).map(([name, value]) => [name, rate(value, counts.scanned)])),
  };
}

/** Detection recall of an adversarial fixture. Secret items use the fixture's own literal needles. */
export function auditAdversarial(items) {
  const redactor = createSecretRedactor(items.filter((item) => typeof item.secret === "string").map((item) => item.secret));
  const byClass = Object.fromEntries(TRUST_SCAN_CLASSES.map((name) => [name, { total: 0, detected: 0, missedIds: [] }]));
  for (const item of items) {
    const bucket = byClass[item.class];
    if (bucket === undefined) throw new Error(`unknown adversarial class: ${item.class}`);
    bucket.total += 1;
    if (refusal(item.text, redactor) === undefined) bucket.missedIds.push(item.id);
    else bucket.detected += 1;
  }
  const total = items.length;
  const detected = total - Object.values(byClass).reduce((sum, bucket) => sum + bucket.missedIds.length, 0);
  return {
    items: total,
    detected,
    recall: total === 0 ? 0 : Number((detected / total).toFixed(4)),
    byClass: Object.fromEntries(
      Object.entries(byClass).map(([name, bucket]) => [
        name,
        { ...bucket, recall: bucket.total === 0 ? 0 : Number((bucket.detected / bucket.total).toFixed(4)) },
      ]),
    ),
  };
}

export function buildReport({ datasets, adversarial, generatedAt = new Date().toISOString() }) {
  const neededLoss = datasets["longmemeval-s"].neededSessionRefusedQuestions;
  return {
    plan: "188.11 Task 8",
    generatedAt,
    modelCalls: 0,
    threshold: {
      enforced: false,
      falseRefusalPer1000: THRESHOLD_PER_1000,
      exceeded: datasets["longmemeval-s"].refusedPer1000 > THRESHOLD_PER_1000 || neededLoss > 0,
    },
    datasets,
    adversarial,
  };
}

function md(report) {
  const rows = Object.entries(report.datasets)
    .map(
      ([name, d]) =>
        `| ${name} | ${d.questions} | ${d.exchanges} | ${d.refusedExchanges} | ${d.refusedPer1000} | ${d.refusedByClass["prompt-injection"]} / ${d.refusedByClass.exfil} / ${d.refusedByClass["invisible-unicode"]} / ${d.refusedByClass.secret} | ${d.neededSessionRefusedQuestions} / ${d.neededQuestions} |`,
    )
    .join("\n");
  const adv = Object.entries(report.adversarial.byClass)
    .map(([name, c]) => `| ${name} | ${c.detected} / ${c.total} | ${c.recall} | ${c.missedIds.join(", ") || "—"} |`)
    .join("\n");
  return `# Exchange archive trust-scan audit (plan 188.11 Task 8)

Generated by \`scripts/memory-bench/trust-scan-audit.mjs\`. Counts, rates and classes only; no corpus
text. Model calls: ${report.modelCalls}. Threshold enforced: no; plan 202 owns the safety gate.

## Benign corpora

| Corpus | Questions | Exchanges | Refused | Refused / 1,000 | Injection / exfil / invisible / secret | Needed-session questions refused / needed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## Adversarial fixture

Detection recall: ${report.adversarial.detected} / ${report.adversarial.items} (${report.adversarial.recall}).

| Class | Detected / total | Recall | Missed ids |
| --- | ---: | ---: | --- |
${adv}
`;
}

async function main() {
  const args = process.argv.slice(2);
  const outputAt = args.indexOf("--output");
  const output = outputAt >= 0 ? args[outputAt + 1] : join(EVIDENCE_DIR, "trust-scan.json");
  if (output === undefined) throw new Error("--output needs a path");
  const started = Date.now();
  const lme = auditQuestions(normalizeDataset(await loadDataset("longmemeval-s"), "longmemeval-s"), createSecretRedactor([]));
  const locomo = auditQuestions(normalizeDataset(await loadDataset("locomo"), "locomo"), createSecretRedactor([]));
  const items = JSON.parse(await readFile(FIXTURE, "utf8"));
  const report = buildReport({ datasets: { "longmemeval-s": lme, locomo }, adversarial: auditAdversarial(items) });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = md(report);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, json);
  await writeFile(output.replace(/\.json$/, ".md"), markdown);
  const digest = createHash("sha256").update(json).digest("hex").slice(0, 12);
  console.log(
    `TRUST-SCAN: ${lme.exchanges + locomo.exchanges} exchanges, ${lme.refusedExchanges + locomo.refusedExchanges} refused; ${output} (${digest}) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

if (import.meta.main) await main();
