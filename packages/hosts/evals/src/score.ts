import type { EvaluationRecord } from "@arnilo/prism";
import { type Message, type RunResult, resolveRedactor } from "@arnilo/prism";
import { EvalError, EvalScoreError } from "./errors.js";
import { DEFAULT_MAX_STEP_SCORES, DEFAULT_SAMPLE_RATE, HARD_MAX_STEP_SCORES } from "./limits.js";
import { mulberry32 } from "./scenarios.js";
import { loadTimeline } from "./timeline.js";
import type {
  DatasetItem,
  EvaluationTarget,
  EvaluationTelemetrySink,
  ExecutionStep,
  ExecutionTimeline,
  LiveScoreOptions,
  ScoreRunOptions,
  Scorer,
  ScorerRequirement,
} from "./types.js";
import { hash32, randomId, redactEvaluationRecord, resolveSampling, shouldSample, toErrorInfo, validateScoreResult } from "./util.js";

function emitEvaluation(record: EvaluationRecord, telemetry?: EvaluationTelemetrySink): void {
  if (!telemetry) return;
  try {
    telemetry.handleEvaluation({
      // Simulator failures can precede a run; correlate the standalone event with its record.
      runId: record.runId ?? record.id,
      name: record.scorerId,
      status: record.status,
      ...(record.score === undefined ? {} : { score: record.score }),
      hasReason: record.reason !== undefined,
    });
  } catch {
    // Observers cannot change scoring or persistence outcomes.
  }
}

function stripInvariant(metadata: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (!("invariant" in metadata) && !("sampling" in metadata)) return metadata;
  const { invariant: _ignored, sampling: _ignoredSampling, ...rest } = metadata;
  return rest;
}

const REQUIREMENT_ERRORS: Readonly<Record<ScorerRequirement, { readonly code: string; readonly hint: string }>> = {
  timeline: {
    code: "ERR_PRISM_EVAL_TIMELINE_REQUIRED",
    hint: 'set timeline: "metadata" (scoreRun needs a traceResolver or an injectedTimeline; runExperiment and runScenario project while running)',
  },
  trace: { code: "ERR_PRISM_EVAL_TRACE_REQUIRED", hint: "pass a traceResolver" },
  environment: { code: "ERR_PRISM_EVAL_ENVIRONMENT_REQUIRED", hint: "pass environment (runExperiment: toEnvironment)" },
};

/**
 * Throws when a scorer's declared input cannot be supplied. Every entry point runs this once, before
 * any agent run, so a misconfiguration is an error and never a zero score.
 */
export function checkRequirements<TInput, TExpected>(
  scorers: readonly Scorer<TInput, TExpected>[],
  available: Readonly<Record<ScorerRequirement, boolean>>,
): void {
  for (const scorer of scorers) {
    for (const requirement of scorer.requires ?? []) {
      if (available[requirement]) continue;
      const { code, hint } = REQUIREMENT_ERRORS[requirement];
      throw new EvalError(`scorer "${scorer.id}" requires ${requirement}; ${hint}`, code);
    }
  }
}

async function scoreOne<TInput, TExpected>(
  scorer: Scorer<TInput, TExpected>,
  options: ScoreRunOptions<TInput, TExpected>,
  sampled: boolean,
  item?: DatasetItem<TInput, TExpected>,
  target?: EvaluationTarget,
  timeline?: ExecutionTimeline,
  step?: ExecutionStep,
  skipReason?: string,
): Promise<EvaluationRecord> {
  const invariant = scorer.invariant === true;
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
    stepId: step?.id,
    nodeId: step?.kind === "workflow_node" ? step.name : undefined,
    createdAt: new Date().toISOString(),
    metadata: invariant ? { ...options.metadata, invariant: true } : options.metadata,
    ...options.ownership,
  } satisfies Omit<EvaluationRecord, "status" | "score" | "reason" | "error">;

  if (!sampled) {
    return redactEvaluationRecord(
      { ...base, status: "skipped", ...(skipReason === undefined ? {} : { reason: skipReason }) },
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
      timeline,
      ...(step === undefined ? {} : { step }),
      environment: options.environment,
      ...(options.redactor === undefined ? {} : { redactor: options.redactor }),
    });
    const scored = validateScoreResult(raw);
    return redactEvaluationRecord(
      {
        ...base,
        status: "scored",
        score: scored.score,
        reason: scored.reason,
        // The declaration decides invariance; a returned `invariant` key must not.
        metadata: scored.metadata ? { ...(base.metadata ?? {}), ...stripInvariant(scored.metadata) } : base.metadata,
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
          error instanceof EvalScoreError || (error instanceof EvalError
            && (error.code.startsWith("ERR_PRISM_EVAL_JUDGE") || error.code === "ERR_PRISM_EVAL_STATE_BOUNDS"))
            ? error
            : new EvalScoreError(error instanceof Error ? error.message : String(error), { cause: error }),
        ),
      },
      options.redactor,
      options.secrets,
    );
  }
}

/** Score one `RunResult` with the provided scorers. Failures become `failed` records. */
export async function scoreRun<TInput = unknown, TExpected = unknown>(
  options: ScoreRunOptions<TInput, TExpected>,
): Promise<readonly EvaluationRecord[]> {
  if (!options.scorers.length) return [];
  const seed = options.seed ?? options.sampling?.seed;
  if (seed !== undefined && !Number.isSafeInteger(seed)) {
    throw new EvalError("seed must be a safe integer", "ERR_PRISM_EVAL_BOUNDS");
  }
  const random =
    options.random ??
    (seed !== undefined
      ? mulberry32(hash32(seed, options.itemId ?? options.item?.id ?? options.result.runId ?? "", 0))
      : undefined);
  const { probability, metadata: samplingMetadata } = resolveSampling(options.result, options.sampling);
  if (probability <= 0) return [];
  const sampled = shouldSample(probability, random);
  const records: EvaluationRecord[] = [];
  const trace =
    sampled && options.traceResolver
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
  let timeline = options.injectedTimeline;
  if (!timeline && sampled && options.timeline && options.timeline !== "off" && trace) {
    const { projectTraceTimeline } = await loadTimeline();
    timeline = projectTraceTimeline(trace, {
      content: options.timeline,
      redactor: options.redactor,
      traceId: options.traceId,
    });
  }
  // Resolve the seam once per run: rebuilding a secret redactor per scored step is pure cost.
  const seam = resolveRedactor(options.redactor, options.secrets);
  const metadata = samplingMetadata ? { ...options.metadata, sampling: samplingMetadata } : options.metadata;
  const scoring =
    (seam === undefined || seam === options.redactor) && metadata === options.metadata
      ? options
      : { ...options, ...(seam === undefined ? {} : { redactor: seam }), metadata };
  const target: EvaluationTarget = {
    result: options.result,
    ...(trace ? { trace } : {}),
    ...(timeline ? { timeline } : {}),
  };

  if (sampled) {
    checkRequirements(options.scorers, {
      timeline: timeline !== undefined,
      trace: trace !== undefined,
      environment: options.environment !== undefined,
    });
  }

  if (options.forEach) {
    const matchingSteps = (timeline?.steps ?? []).filter((s) => {
      if (options.forEach === "tool") return s.kind === "tool";
      if (options.forEach === "workflow_node") return s.kind === "workflow_node";
      return false;
    });

    const cap = Math.min(
      options.maxStepScores !== undefined && Number.isInteger(options.maxStepScores) && options.maxStepScores > 0
        ? options.maxStepScores
        : DEFAULT_MAX_STEP_SCORES,
      HARD_MAX_STEP_SCORES,
    );
    const stepsToScore = matchingSteps.slice(0, cap);

    if (!stepsToScore.length) {
      // Nothing matched: one explicit skip per scorer, so "no step ran" never reads as "no failures".
      for (const scorer of options.scorers) {
        const record = await scoreOne(scorer, scoring, false, options.item, target, timeline, undefined, "no matching steps");
        if (options.store) await options.store.append(record);
        emitEvaluation(record, options.telemetry);
        records.push(record);
      }
      return records;
    }

    for (const step of stepsToScore) {
      for (const scorer of options.scorers) {
        const record = await scoreOne(scorer, scoring, sampled, options.item, target, timeline, step);
        if (options.store) await options.store.append(record);
        emitEvaluation(record, options.telemetry);
        records.push(record);
      }
    }
  } else {
    for (const scorer of options.scorers) {
      const record = await scoreOne(scorer, scoring, sampled, options.item, target, timeline);
      if (options.store) await options.store.append(record);
      emitEvaluation(record, options.telemetry);
      records.push(record);
    }
  }

  return records;
}

/**
 * Live post-run scoring helper. Returns a promise the host may ignore.
 * Scoring failure never mutates `result` and is attributable via `failed` records / `onError`.
 */
export function scoreRunLive<TInput = unknown, TExpected = unknown>(
  result: RunResult,
  options: LiveScoreOptions<TInput, TExpected>,
): Promise<readonly EvaluationRecord[]> {
  const telemetry = options.telemetry;
  const sampling = options.sampling ?? { rate: DEFAULT_SAMPLE_RATE };
  return scoreRun({ ...options, result, sampling, ...(telemetry ? { telemetry: {
    handleEvaluation(evaluation) {
      try { telemetry.handleEvaluation(evaluation); }
      catch (error) { options.onError?.(error); }
    },
  } } : {}) }).catch((error) => {
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
  return Boolean(value && typeof value === "object" && "role" in value && "content" in value && Array.isArray((value as Message).content));
}

/** Infrastructure failure skips all scorers without inventing an agent result or invoking scorers. */
export async function skipScorers<TInput, TExpected>(
  options: Omit<ScoreRunOptions<TInput, TExpected>, "result"> & { result?: RunResult }, reason: string,
): Promise<EvaluationRecord[]> {
  const records: EvaluationRecord[] = [];
  for (const scorer of options.scorers) {
    const record = redactEvaluationRecord({ id: randomId("eval"), scorerId: scorer.id, sampled: false,
      status: "skipped", reason, sessionId: options.result?.sessionId, runId: options.result?.runId,
      datasetId: options.datasetId, itemId: options.itemId, experimentId: options.experimentId,
      traceId: options.traceId, createdAt: new Date().toISOString(), ...options.ownership,
      metadata: scorer.invariant ? { ...options.metadata, invariant: true } : options.metadata,
    }, options.redactor, options.secrets);
    await options.store?.append(record);
    emitEvaluation(record, options.telemetry);
    records.push(record);
  }
  return records;
}
