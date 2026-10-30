#!/usr/bin/env bun
/** Offline Task 5.1 inventory. Never opens a provider or changes the closed campaign. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { DATASETS, loadDataset, normalizeDataset, selectQuestions } from "../datasets.mjs";
import { createAnswerCache } from "../judge.mjs";
import { causalSessions, extractEvidence, sessionRounds, toolSurfacing } from "../replay.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const base = "docs/_evidence/memory-bench/202";

/** Requires complete successful-attempt delivery and a verified note-to-round map for negatives. */
export function recoverToolSurfacing({ trace, needed, roundMap = new Map(), complete = false, unresolvedGold = 0, attempt = 0 }) {
  const surfaced = new Set();
  let unmappedResults = 0;
  for (const request of trace?.requests ?? []) {
    if (request.attempt !== attempt) continue;
    for (const message of request.messages ?? [])
      for (const block of message.content ?? []) {
        if (block.type !== "tool_result" || block.error) continue;
        const notes = block.name === "memory.recall" ? block.result?.hits : block.name === "memory.read" ? block.result?.notes : [];
        for (const note of notes ?? []) {
          if (roundMap.has(note.id)) surfaced.add(roundMap.get(note.id));
          else unmappedResults++;
        }
        // Old single-note reads need their verified note id; text is never searched for gold.
        if (block.name === "memory.read" && typeof block.result?.text === "string" && !block.result?.notes) unmappedResults++;
      }
  }
  return {
    surfacedRoundIds: [...surfaced],
    unmappedResults,
    surfacing: trace && complete && needed.length && !unresolvedGold && !unmappedResults ? toolSurfacing(needed, surfaced) : null,
  };
}

export async function auditTask5Traces() {
  const protectedFiles = new Map();
  async function pin(path, expected) {
    const bytes = await readFile(path);
    const hash = sha(bytes);
    if (expected) assert.equal(hash, expected, `Source hash mismatch: ${path}`);
    protectedFiles.set(path, hash);
    return JSON.parse(bytes);
  }
  const closurePath = `${base}/muse13-screen-closure.json`;
  const closure = await pin(closurePath);
  assert.equal(closure.status, "closed-by-owner");
  const final = await pin(closure.acceptedManifest);
  const original = await pin(final.originalManifest.path, final.originalManifest.sha256);
  await pin(final.sourceJournal.path, final.sourceJournal.sha256);
  for (const file of ["README.md", "summary.json", "verification.json", "validation.json"])
    protectedFiles.set(`${base}/muse13-screen-final/${file}`, sha(await readFile(`${base}/muse13-screen-final/${file}`)));
  await pin(".cache/memory-bench/202-muse13-screen/journal.json");
  const reports = [];
  for (const record of final.reports) reports.push({ record, report: await pin(record.path, record.sha256) });
  assert.equal(reports.length, 23);

  // Search all retained answer/checkpoint caches, including the separately frozen pilot runs.
  const cacheFiles = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory() && !["python", "node_modules", "notes", ".git"].includes(entry.name)) await walk(join(path, entry.name));
      else if (entry.isFile() && entry.name.endsWith(".json") && /\/(answers|checkpoints)\//.test(join(path, entry.name)))
        cacheFiles.push(join(path, entry.name));
    }
  }
  await walk(".cache/memory-bench");
  const privateInventory = [];
  const cacheByKey = new Map();
  for (const path of cacheFiles.sort()) {
    const bytes = await readFile(path);
    const data = JSON.parse(bytes);
    const traceKind = Array.isArray(data.trace) ? "bounded-provider-pilot" : data.trace?.requests ? "delivery-trace" : "none";
    privateInventory.push({ path, sha256: sha(bytes), traceKind });
    const key = path
      .split("/")
      .at(-1)
      .replace(/\.json$/, "");
    const entries = cacheByKey.get(key) ?? [];
    entries.push({ path, sha256: sha(bytes), traceKind });
    cacheByKey.set(key, entries);
  }
  const cells = [];
  const answerCache = createAnswerCache({ root: ".cache/memory-bench/answers" });
  for (const { record, report } of reports.filter(({ report }) => report.config === "fabric-x-tools")) {
    assert.equal(report.subset, "dev", "Task 5 trace audit refuses non-development evidence");
    const questions = selectQuestions(
      normalizeDataset(
        await loadDataset(report.suite, {
          fetch: () => {
            throw new Error("Offline audit requires cached datasets");
          },
        }),
        report.suite,
      ),
      report.suite,
      { subset: "dev" },
    );
    const byId = new Map(questions.map((question) => [question.id, question]));
    assert.equal(report.results.length, questions.length);
    const rows = [];
    for (const row of report.results) {
      const question = byId.get(row.id);
      assert(question, "Report id is outside the frozen development cohort");
      const rounds = causalSessions(question).flatMap((session, index) => sessionRounds(session, index));
      const evidence = extractEvidence(question, rounds);
      const key = answerCache.key({ protocolHash: report.protocolHash, id: row.id });
      const retained = cacheByKey.get(key) ?? [];
      // Current historical reports have no compatible delivery traces. Stop for manual provenance
      // review if one appears, rather than silently certifying an incomplete or unrelated trace.
      assert(!retained.some((item) => item.traceKind !== "none"), "Matching trace requires provenance/completeness review");
      assert.equal(row.evidenceCounts?.toolSurfacing ?? null, null);
      rows.push({
        id: row.id,
        ability: row.ability,
        outcome: row.outcome ?? "scored",
        answerRetries: row.answerRetries,
        neededRoundIds: [...evidence.fineGoldIds],
        unresolvedGoldReferences: evidence.unknownSourceReferences.map(({ id, sourceId, status }) => ({ id: id ?? sourceId, status })),
        goldStatus: evidence.unknownSourceReferences.length ? "unresolved" : evidence.fineGoldIds.size ? "mapped" : "no-fine-round-labels",
        cacheKey: key,
        retained,
        traceStatus: retained.length ? "checkpoint-without-tool-trace" : "missing",
        toolSurfacing: null,
      });
    }
    const log = `.cache/memory-bench/202/muse13-screen/${record.jobId.replace(/[^a-zA-Z0-9_.:-]/g, "_")}_1.log`;
    let logPin = null;
    try {
      logPin = { path: log, sha256: sha(await readFile(log)), kind: "progress-log-not-tool-results" };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    cells.push({
      jobId: record.jobId,
      suite: report.suite,
      model: `${report.provider}/${report.model}`,
      subset: report.subset,
      productRevision: 1,
      productHash: original.productHash,
      sourceRevision: report.sourceRevision,
      report: { path: relative(process.cwd(), record.path), sha256: record.sha256 },
      protocolHash: report.protocolHash,
      runPathFingerprint: report.runPathFingerprint,
      dataset: DATASETS[report.suite],
      progressLog: logPin,
      questions: rows.length,
      observedSurfacing: 0,
      unknownSurfacing: rows.length,
      mappedGoldQuestions: rows.filter((row) => row.goldStatus === "mapped").length,
      unresolvedGoldQuestions: rows.filter((row) => row.goldStatus === "unresolved").length,
      noFineGoldQuestions: rows.filter((row) => row.goldStatus === "no-fine-round-labels").length,
      historicalIngestValid: report.suite !== "memoryagentbench-cr",
      baselineReuseEligible: false,
      rows,
    });
  }
  assert.equal(cells.length, 5);
  for (const [path, hash] of protectedFiles) assert.equal(sha(await readFile(path)), hash, `Closed artifact changed: ${path}`);
  const sources = [];
  for (const path of [
    "scripts/memory-bench/audit/task5-traces.mjs",
    "scripts/memory-bench/replay.mjs",
    "scripts/memory-bench/retrieval-diagnostics.mjs",
    "scripts/memory-bench/baseline.mjs",
    "scripts/memory-bench/datasets.mjs",
    "scripts/memory-bench/judge.mjs",
    ".cache/memory-bench/frozen-muse-v5/scripts/memory-bench/replay.mjs",
    ".cache/memory-bench/frozen-muse-v5/scripts/memory-bench/run.mjs",
  ])
    sources.push({ path, sha256: sha(await readFile(path)) });
  const result = {
    kind: "202-task5-revision1-tool-surfacing-inventory",
    generatedAt: new Date().toISOString(),
    liveCalls: 0,
    productRevision: 1,
    productHash: original.productHash,
    sources,
    protectedArtifacts: [...protectedFiles].map(([path, sha256]) => ({
      path: relative(process.cwd(), path.startsWith("/") ? path : join(process.cwd(), path)),
      sha256,
    })),
    closedReportHashesVerified: reports.length,
    closedArtifactsUnchanged: true,
    privateInventory,
    cells,
    requiredFreshControls: cells.map((cell) => ({
      suite: cell.suite,
      subset: "dev",
      arm: "preset-r1",
      questionIds: cell.rows.map((row) => row.id),
      historicalModel: cell.model,
      historicalProductHash: cell.productHash,
      disposition:
        "Fresh revision-1 control required; freeze corrected ingestion/mapping and candidate-matched model/judges/budgets in Task 5.2",
    })),
    limitations: [
      "All-phase historical runs did not retain per-call inputs/results or note-to-round maps; mixed recalledIds are not tool evidence.",
      "Separate bounded pilot traces are different executions and cannot repair the closed screen, even when question ids overlap.",
      "Round ids measure result presence, not survival of every labelled fact in rendered excerpts.",
      "MAB historical ingestion is invalid; questions without fine labels and unresolved references remain unmeasurable, never zero-gap.",
      "Five historical cells do not narrow all-applicable-suite or multi-model acceptance; Task 5.2 must state remaining coverage explicitly.",
      "No historical paid model/judge run is authorized here. Future live work is restricted by the user's OpenRouter-free-only instruction.",
    ],
  };
  await mkdir(`${base}/task5`, { recursive: true });
  await writeFile(`${base}/task5/revision1-trace-inventory.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify({
      cells: cells.length,
      questions: cells.reduce((n, cell) => n + cell.questions, 0),
      observedSurfacing: 0,
      privateArtifacts: privateInventory.length,
      closedArtifactsUnchanged: true,
    }),
  );
  return result;
}

if (import.meta.main) await auditTask5Traces();
