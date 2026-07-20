import type { AgentRunResult, Message } from "@arnilo/prism";
import { EvalScoreError } from "./errors.js";
import type {
  DatasetItem,
  EvaluationRecord,
  EvaluationTarget,
  LiveScoreOptions,
  ScoreRunOptions,
  Scorer,
} from "./types.js";
import {
  normalizeSampleRate,
  randomId,
  redactEvaluationRecord,
  shouldSample,
  toErrorInfo,
  validateScoreResult,
} from "./util.js";

async function scoreOne<TInput, TExpected>(
  scorer: Scorer<TInput, TExpected>,
  options: ScoreRunOptions<TInput, TExpected>,
  sampled: boolean,
  item?: DatasetItem<TInput, TExpected>,
  target?: EvaluationTarget,
): Promise<EvaluationRecord> {
  const base = {
    id: randomId("eval"),
    scorerId: scorer.id,
    sampled,
    sessionId: options.result.sessionId,
    runId: options.result.runId,
    traceId: options.traceId,
    datasetId: options.datasetId,
    itemId: options.itemId ?? item?.id,
    experimentId: options.experimentId,
    createdAt: new Date().toISOString(),
    metadata: options.metadata,
    ...options.ownership,
  } satisfies Omit<EvaluationRecord, "status" | "score" | "reason" | "error">;

  if (!sampled) {
    return redactEvaluationRecord(
      { ...base, status: "skipped" },
      options.redactor,
      options.secrets,
    );
  }

  try {
    options.signal?.throwIfAborted();
    const raw = await scorer.score({
      result: options.result,
      item,
      expected: item?.expected,
      signal: options.signal,
      target,
    });
    const scored = validateScoreResult(raw);
    return redactEvaluationRecord(
      {
        ...base,
        status: "scored",
        score: scored.score,
        reason: scored.reason,
        metadata: scored.metadata ? { ...options.metadata, ...scored.metadata } : options.metadata,
      },
      options.redactor,
      options.secrets,
    );
  } catch (error) {
    return redactEvaluationRecord(
      {
        ...base,
        status: "failed",
        error: toErrorInfo(
          error instanceof EvalScoreError
            ? error
            : new EvalScoreError(error instanceof Error ? error.message : String(error), { cause: error }),
        ),
      },
      options.redactor,
      options.secrets,
    );
  }
}

/** Score one `AgentRunResult` with the provided scorers. Failures become `failed` records. */
export async function scoreRun<TInput = unknown, TExpected = unknown>(
  options: ScoreRunOptions<TInput, TExpected>,
): Promise<readonly EvaluationRecord[]> {
  if (!options.scorers.length) return [];
  const sampleRate = normalizeSampleRate(options.sampleRate);
  const sampled = shouldSample(sampleRate, options.random);
  const records: EvaluationRecord[] = [];
  const trace = sampled && options.traceResolver
    ? await options.traceResolver({
        ...options.ownership,
        sessionId: options.result.sessionId,
        runId: options.result.runId,
        limits: options.traceLimits,
        redactor: options.redactor,
        secrets: options.secrets,
        signal: options.signal,
      })
    : undefined;
  const target = trace ? { result: options.result, trace } : { result: options.result };

  for (const scorer of options.scorers) {
    const record = await scoreOne(scorer, options, sampled, options.item, target);
    if (options.store) await options.store.append(record);
    records.push(record);
  }
  return records;
}

/**
 * Live post-run scoring helper. Returns a promise the host may ignore.
 * Scoring failure never mutates `result` and is attributable via `failed` records / `onError`.
 */
export function scoreRunLive<TInput = unknown, TExpected = unknown>(
  result: AgentRunResult,
  options: LiveScoreOptions<TInput, TExpected>,
): Promise<readonly EvaluationRecord[]> {
  return scoreRun({ ...options, result }).catch((error) => {
    options.onError?.(error);
    return [];
  });
}

export function defaultToAgentInput(input: unknown): string | Message | readonly Message[] {
  if (typeof input === "string") return input;
  if (isMessage(input)) return input;
  if (Array.isArray(input) && input.every(isMessage)) return input;
  return JSON.stringify(input ?? null);
}

function isMessage(value: unknown): value is Message {
  return Boolean(
    value
    && typeof value === "object"
    && "role" in value
    && "content" in value
    && Array.isArray((value as Message).content),
  );
}
