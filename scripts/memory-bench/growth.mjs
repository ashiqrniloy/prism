/**
 * Plan 202 Task 15: a dated twelve-month growth stream with the normal maintenance pass.
 *
 * The harness is offline: it writes exchange notes, calls `fabric.maintain()` after each month, and
 * asks the same month-1 questions at months 1, 6 and 12. "Accuracy" here is lexical retrieval of the
 * expected month-1 exchange, not a model answer; no model call is made. The evidence names both so a
 * reader cannot mistake the metric for end-to-end QA accuracy.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { resolveLifecycleConfig } from "../../packages/memory/system/src/ltm/config.js";
import { createMemory, createLongTermMemory } from "../../packages/memory/system/src/index.js";

const MONTHS = 12;
const DEFAULT_HOT_TOKENS = 200_000;
const DEFAULT_QUESTIONS = 3;
const MAX_SESSION_CHARS = 1_200;

function monthFor(index, total) {
  return Math.min(MONTHS, Math.floor((index * MONTHS) / Math.max(1, total)) + 1);
}

function simulatedDate(month, withinMonth) {
  const date = new Date(Date.UTC(2025, month - 1, 1 + (withinMonth % 27), withinMonth % 24, withinMonth % 60));
  return date.toISOString();
}

function firstText(messages, role) {
  const message = messages.find((item) => item.role === role && typeof item.text === "string" && item.text.trim().length > 0);
  return message?.text.replace(/\s+/g, " ").trim() ?? "";
}

/** One exchange per dated session; the full session text is bounded so write cost stays predictable. */
export function growthSessions(row, prefix) {
  return row.sessions.map((session, index) => {
    const user = firstText(session.messages, "user") || `session ${index}`;
    const assistant = firstText(session.messages, "assistant") || "recorded";
    const month = monthFor(index, row.sessions.length);
    return {
      id: createHash("sha256").update(`${prefix}s${index}`).digest("hex").slice(0, 12),
      sessionId: `${prefix}s${index}`,
      month,
      tRef: session.date ?? simulatedDate(month, index),
      content: `user: ${user}\n\nassistant: ${assistant}`.slice(0, MAX_SESSION_CHARS),
      phrase: user.split(" ").slice(0, 12).join(" "),
    };
  });
}

/** Month-1 questions with the exchange id that answers each one; no gold answer text is used. */
export function monthOneQuestions(sessions, row, prefix) {
  const monthOne = sessions.filter((session) => session.month === 1);
  const questions = monthOne.slice(0, 5).map((session) => ({
    id: `content-${session.id}`,
    question: `What did we say about "${session.phrase}"?`,
    expected: [session.id],
    kind: "content",
  }));
  const answerIndexes = (row.answerSessionIds ?? [])
    .map((id) => row.sessions.findIndex((session) => session.id === id))
    .filter((index) => index >= 0 && monthFor(index, row.sessions.length) === 1);
  for (const index of answerIndexes.slice(0, 2)) {
    questions.push({
      id: `dataset-${row.id}`,
      question: row.question,
      expected: [createHash("sha256").update(`${prefix}s${index}`).digest("hex").slice(0, 12)],
      kind: "dataset-question",
    });
  }
  return questions;
}

function rate(questions, correct) {
  const hits = questions.filter((question) => correct.has(question.id)).length;
  return questions.length === 0 ? 0 : Number((hits / questions.length).toFixed(4));
}

function criterion(month1, month12) {
  // Pre-registered in Task 15: month-12 accuracy must be within 3 points of month 1.
  return month12 >= month1 - 0.03;
}

export async function runGrowth(options = {}) {
  const rows = options.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("GrowthDatasetRequired");
  const maxQuestions = options.maxQuestions ?? DEFAULT_QUESTIONS;
  const selected = rows.slice(0, maxQuestions);
  const vectorStore = createMemoryVectorStore();
  const memory = createMemory({ tenantId: "growth", resourceId: "archive", threadId: "monthly", vectorStore });
  let clock = 0;
  const lifecycle = resolveLifecycleConfig({
    exchangeCapacity: { hotTokens: options.hotTokens ?? DEFAULT_HOT_TOKENS },
    archive: { graceSessions: options.graceSessions ?? 10 },
  });
  const fabric = createLongTermMemory({
    memory,
    vectorStore,
    consolidate: false,
    lifecycle,
    clock: () => clock,
  });

  const histories = selected.map((row, rowIndex) => {
    const prefix = `g${rowIndex}-`;
    const sessions = growthSessions(row, prefix);
    return { row, prefix, sessions, questions: monthOneQuestions(sessions, row, prefix) };
  });
  const questions = histories.flatMap((history) => history.questions);

  const writeMonth = async (month) => {
    for (const history of histories) {
      for (const session of history.sessions.filter((item) => item.month === month)) {
        await fabric.remember({
          id: session.id,
          kind: "exchange",
          content: session.content,
          session: session.sessionId,
          tRef: session.tRef,
        });
        clock += 1;
        await vectorStore.scopeCounter?.increment({ tenantId: "growth", resourceId: "archive", name: "sessions" });
      }
    }
  };

  const measure = async () => {
    const correct = new Set();
    const inclusive = new Set();
    for (const question of questions) {
      const hits = await fabric.recall(question.question, { kinds: ["exchange"], topK: 12, minSimilarity: 0 });
      if (hits.hits.some((hit) => question.expected.includes(hit.id))) correct.add(question.id);
      const all = await fabric.recall(question.question, {
        kinds: ["exchange"],
        topK: 12,
        minSimilarity: 0,
        includeArchived: true,
      });
      if (all.hits.some((hit) => question.expected.includes(hit.id))) inclusive.add(question.id);
    }
    return { correct, inclusive };
  };

  const snapshots = {};
  for (let month = 1; month <= MONTHS; month++) {
    await writeMonth(month);
    const report = await fabric.maintain();
    if (month === 1 || month === 6 || month === MONTHS) {
      const measured = await measure();
      snapshots[month] = {
        archivedTotal: report.archived + report.evicted,
        archived: report.archived,
        demoted: report.evicted,
        accuracy: rate(questions, measured.correct),
        archivedInclusiveAccuracy: rate(questions, measured.inclusive),
        contentAccuracy: rate(
          questions.filter((question) => question.kind === "content"),
          measured.correct,
        ),
        datasetQuestionAccuracy: rate(
          questions.filter((question) => question.kind === "dataset-question"),
          measured.correct,
        ),
      };
    }
  }

  const month1 = snapshots[1]?.accuracy ?? 0;
  const month12 = snapshots[MONTHS]?.accuracy ?? 0;
  return {
    schemaVersion: 1,
    suite: "dated-growth",
    source: options.source ?? "synthetic",
    metric: "offline lexical retrieval of the expected month-1 exchange",
    modelCalls: 0,
    months: MONTHS,
    histories: histories.map((history) => ({ id: history.row.id, sessions: history.sessions.length })),
    exchanges: histories.reduce((sum, history) => sum + history.sessions.length, 0),
    questions: questions.length,
    hotTokens: options.hotTokens ?? DEFAULT_HOT_TOKENS,
    graceSessions: options.graceSessions ?? 10,
    clock,
    criterion: { month1, month12, tolerancePoints: 3, pass: criterion(month1, month12) },
    snapshots,
  };
}

export function renderGrowthMarkdown(report) {
  const rows = [1, 6, 12].map((month) => {
    const snapshot = report.snapshots[month];
    return `| ${month} | ${snapshot.accuracy.toFixed(4)} | ${snapshot.archivedInclusiveAccuracy.toFixed(4)} | ${snapshot.contentAccuracy.toFixed(4)} | ${snapshot.datasetQuestionAccuracy.toFixed(4)} | ${snapshot.archivedTotal} | ${snapshot.archived} | ${snapshot.demoted} |`;
  });
  return `# Growth simulation — ${report.source}

Plan 202 Task 15. ${report.exchanges} dated exchange notes from ${report.histories.length} LongMemEval-M histor${report.histories.length === 1 ? "y" : "ies"}, streamed over 12 simulated months into one store. \`fabric.maintain()\` ran after every month (the normal nightly trigger). The exchange tier was ${report.hotTokens} hot tokens. No model call was made.

**Criterion (pre-registered):** month-12 accuracy on month-1 questions within 3 points of month 1. **${report.criterion.pass ? "PASS" : "FAIL"}** — month 1 ${report.criterion.month1.toFixed(4)}, month 12 ${report.criterion.month12.toFixed(4)}.

Accuracy is offline lexical retrieval of the expected month-1 exchange, not an end-to-end model answer. "Inclusive" additionally asks recall to include the searchable archive.

| Month | Accuracy | Inclusive | Content questions | Dataset question | Archived total | By age | By tier |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}

The ${report.exchanges} writes produced a clock of ${report.clock} sessions. A demotion changes status to \`archived\` and keeps the exchange text; it never deletes it.
`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const valueOf = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const output = valueOf("--output");
  const maxQuestions = Number(valueOf("--questions") ?? DEFAULT_QUESTIONS);
  assert.ok(Number.isSafeInteger(maxQuestions) && maxQuestions > 0, "questions must be a positive integer");
  const hotTokens = Number(valueOf("--hot-tokens") ?? DEFAULT_HOT_TOKENS);
  assert.ok(Number.isSafeInteger(hotTokens) && hotTokens > 0, "hot tokens must be a positive integer");
  const graceSessions = Number(valueOf("--grace-sessions") ?? 10);
  assert.ok(Number.isSafeInteger(graceSessions) && graceSessions >= 0, "grace sessions must be a non-negative integer");
  const { loadDataset, normalizeDataset } = await import("./datasets.mjs");
  const suite = valueOf("--suite") ?? "longmemeval-m";
  const raw = await loadDataset(suite);
  const rows = normalizeDataset(raw, suite);
  const report = await runGrowth({
    rows,
    maxQuestions,
    hotTokens,
    graceSessions,
    source: `${suite} (${rows.length} rows available)`,
  });
  if (output !== undefined) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(output.replace(/\.json$/, ".md"), renderGrowthMarkdown(report));
  }
  console.log(JSON.stringify(report));
}
