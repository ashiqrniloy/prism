#!/usr/bin/env bun
/** Complete the one missing v3 evaluation; never generate or select another answer. */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { PREFIX_PRODUCT_PATHS, sourceFingerprint } from "../acceptance.mjs";
import { loadDataset, normalizeDataset, selectQuestions } from "../datasets.mjs";
import {
  acquireCampaignLock,
  campaignLockPath,
  openJournal,
  reconcileAttempt,
  releaseCampaignLock,
  reserveAttempt,
  saveJournal,
  stableHash,
} from "../journal.mjs";
import { combineGraded, combineVerdicts, GRADED_TEMPLATE_VERSION, JUDGE_TEMPLATE_VERSION, scoreAnswer, scoreGraded } from "../judge.mjs";
import { askJudge } from "../run.mjs";
import { createTiming } from "../timing.mjs";
import { pilotComparisons } from "./pilot.mjs";
import { JUDGES, openDiagnostic } from "./zero-score.mjs";

const ROOT = ".cache/memory-bench/audit/4.7-v3/rejudge";
const EVIDENCE = "docs/_evidence/memory-bench/202/pilot-v3";
const LIMITS = { wireAttempts: 16, inputTokens: 250_000, outputTokens: 100_000, wallMs: 1_800_000, retries429: 4 };
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const write = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

/** Immutable join: a lost judge stream cannot replace an answer or erase its failed-call cost. */
export function completePilotScoring(source, completion) {
  if (completion.status !== "completed") throw new Error("Pilot scoring completion is not completed");
  const target = source.cells.find((row) => row.jobId === completion.jobId);
  if (target?.outcome !== "evaluation_error" || target.answerKey !== completion.answerKey) throw new Error("Pilot checkpoint mismatch");
  if (typeof completion.correct !== "boolean" || !Number.isFinite(completion.graded) || completion.graded < 0 || completion.graded > 1)
    throw new Error("Pilot completion missing score");
  const add = (a, b) =>
    Object.fromEntries(
      [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].map((key) => [key, (a?.[key] ?? 0) + (b?.[key] ?? 0)]),
    );
  const cells = source.cells.map((row) =>
    row !== target
      ? row
      : {
          ...row,
          outcome: "completed",
          priorOutcome: row.outcome,
          correct: completion.correct,
          judgeVerdicts: completion.binary,
          gradedJudges: completion.gradedJudges,
          ...combineGraded(completion.gradedJudges),
          evaluationUsage: add(row.evaluationUsage, completion.usage),
          phaseTiming: { ...row.phaseTiming, evaluation: (row.phaseTiming?.evaluation ?? 0) + completion.timing.wallMs },
        },
  );
  return {
    ...source,
    status: cells.some((row) => ["error", "evaluation_error", "not_started"].includes(row.outcome))
      ? "completed_with_failures"
      : "completed",
    cells,
    usage: add(source.usage, completion.usage),
    scoringCompletion: completion,
    timing: { ...source.timing, wallMs: source.timing.wallMs + completion.timing.wallMs, scoringCompletion: completion.timing },
    comparisons: pilotComparisons(
      cells,
      cells.filter((row) => row.config === "full").map((row) => row.id),
    ),
  };
}

async function main() {
  const manifest = await read(join(EVIDENCE, "manifest.json"));
  const source = await read(join(EVIDENCE, "results.json"));
  const failed = source.cells.filter((row) => row.outcome === "evaluation_error");
  if (failed.length !== 1 || failed[0].jobId !== "full.10:summarization:0" || !failed[0].answerKey)
    throw new Error("Rejudge requires the single preserved v3 failed cell");
  if (
    manifest.productHash !== (await sourceFingerprint(PREFIX_PRODUCT_PATHS)) ||
    source.manifestHash !== stableHash(manifest) ||
    manifest.judgeTemplateVersion !== JUDGE_TEMPLATE_VERSION ||
    manifest.gradedTemplateVersion !== GRADED_TEMPLATE_VERSION
  )
    throw new Error("Rejudge protocol drift");
  const row = failed[0];
  const checkpoint = await read(join(".cache/memory-bench/audit/4.7-v3/checkpoints", `${row.answerKey}.json`));
  const protocol = {
    kind: "202-pilot-scoring-completion-v1",
    originalManifestHash: source.manifestHash,
    originalResultsHash: stableHash(source),
    answerHash: stableHash(checkpoint.response.answer),
    answerKey: row.answerKey,
    judges: JUDGES,
    judgeTemplateVersion: JUDGE_TEMPLATE_VERSION,
    gradedTemplateVersion: GRADED_TEMPLATE_VERSION,
    limits: LIMITS,
    generation: { temperature: 0, maxTokens: 8192 },
    jobs: [{ id: row.jobId, suite: "beam-100k", subset: "dev", config: "full" }],
    provider: "openrouter",
    model: "judge-panel-only",
    ceiling: 750_000,
    policy:
      "Same saved answer, same panel/templates/parameters; no new answer, model replacement or product change. Both binary and graded judges rerun. Extra attempt remains charged within original total allowance.",
  };
  const path = join(EVIDENCE, "rejudge-manifest.json");
  if (process.argv.includes("--freeze")) {
    if (existsSync(path)) throw new Error("Already frozen");
    await write(path, protocol);
    return;
  }
  if (stableHash(protocol) !== stableHash(await read(path))) throw new Error("Rejudge identity drift");
  const output = join(EVIDENCE, "scoring-completion.json");
  if (existsSync(output)) throw new Error("Rejudge already attempted");
  const dev = selectQuestions(normalizeDataset(await loadDataset("beam-100k"), "beam-100k"), "beam-100k", { subset: "dev" });
  const q = dev.find((q) => q.id === row.id);
  if (!q) throw new Error("Development question missing");
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  const journalPath = join(ROOT, "journal.json");
  const lock = campaignLockPath(journalPath);
  await acquireCampaignLock(lock);
  const journal = await openJournal({ path: journalPath, manifest: protocol });
  if (journal.attempts.length) {
    await releaseCampaignLock(lock);
    throw new Error("Rejudge already reserved");
  }
  const attempt = reserveAttempt(journal, { jobId: row.jobId, output, maxInputTokens: LIMITS.inputTokens });
  await saveJournal(journalPath, journal);
  const result = {
    kind: protocol.kind,
    protocolHash: stableHash(protocol),
    jobId: row.jobId,
    answerKey: row.answerKey,
    status: "running",
    binary: {},
    gradedJudges: {},
  };
  const agents = [];
  const timing = createTiming();
  const started = Date.now();
  let session;
  try {
    session = await openDiagnostic({ root: ROOT, refs: JUDGES, limits: LIMITS });
    for (const ref of JUDGES) {
      const agent = await createAgent({
        model: { ...session.live.models.get(ref), parameters: protocol.generation },
        packages: [providerPackage(`pilot-rejudge-${agents.length}`, session.live.providers)],
        retry: false,
        compaction: false,
        limits: { maxTurns: 1, maxInputTokens: null, maxTotalTokens: null, maxWallTimeMs: 300_000 },
      });
      agents.push(agent);
      const generate = (prompt, options) =>
        askJudge({
          agent,
          prompt,
          ...options,
          textMode: true,
          account: session.account,
          ceilingReached: session.ceilingReached,
          calls: { judge: 0, judgeAttempts: 0 },
          timing,
          timeoutMs: 300_000,
        });
      result.binary[ref] = (await scoreAnswer(q, checkpoint.response.answer, "beam-100k", generate)).correct ? "yes" : "no";
      result.gradedJudges[ref] = (await scoreGraded(q, checkpoint.response.answer, generate)).graded;
    }
    result.correct = combineVerdicts(result.binary) === "yes";
    Object.assign(result, combineGraded(result.gradedJudges));
    result.status = "completed";
  } catch (error) {
    result.status = "evaluation_error";
    await writeFile(join(ROOT, "error.json"), JSON.stringify({ message: error.message, cause: error.cause }), { mode: 0o600 });
  } finally {
    await session?.account();
    result.usage = session?.usage() ?? null;
    result.timing = timing.summary({ wallMs: Date.now() - started, concurrency: 1 });
    await write(output, result);
    reconcileAttempt(journal, attempt.attemptId, {
      status: result.status === "completed" ? "completed" : "failed",
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      usageComplete: false,
    });
    await saveJournal(journalPath, journal);
    try {
      for (const agent of agents) await agent.dispose();
    } finally {
      session?.close();
      await releaseCampaignLock(lock);
    }
  }
  console.log(`${row.jobId}: ${result.status} binary=${result.correct} graded=${result.graded}`);
}

if (import.meta.main) {
  if (process.argv.includes("--compose")) {
    const source = await read(join(EVIDENCE, "results.json"));
    const completion = await read(join(EVIDENCE, "scoring-completion.json"));
    const protocol = await read(join(EVIDENCE, "rejudge-manifest.json"));
    if (completion.protocolHash !== stableHash(protocol) || protocol.originalResultsHash !== stableHash(source))
      throw new Error("Scoring completion provenance mismatch");
    await write(join(EVIDENCE, "final-results.json"), completePilotScoring(source, completion));
  } else await main();
}
