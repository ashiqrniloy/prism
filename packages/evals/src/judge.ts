import { EvalError } from "./errors.js";
import {
  DEFAULT_JUDGE_MAX_ATTEMPTS,
  DEFAULT_JUDGE_MAX_OUTPUT_BYTES,
  DEFAULT_JUDGE_MAX_INPUT_BYTES,
  DEFAULT_JUDGE_MAX_RUBRIC_BYTES,
  DEFAULT_JUDGE_TIMEOUT_MS,
  HARD_JUDGE_MAX_ATTEMPTS,
  HARD_JUDGE_MAX_OUTPUT_BYTES,
  HARD_JUDGE_MAX_INPUT_BYTES,
  HARD_JUDGE_MAX_RUBRIC_BYTES,
  HARD_JUDGE_TIMEOUT_MS,
} from "./limits.js";
import type { ModelJudgeOptions, Scorer } from "./types.js";
import { validateScoreResult } from "./util.js";

function bounded(value: number | undefined, fallback: number, hard: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 1 || selected > hard) {
    throw new EvalError(`${name} must be an integer in [1, ${hard}]`, "ERR_PRISM_EVAL_JUDGE_BOUNDS");
  }
  return selected;
}

/** Adapt an explicit host model call into a bounded scorer. No provider or credentials are captured. */
export function createModelJudge<TInput = unknown, TExpected = unknown>(
  options: ModelJudgeOptions<TInput, TExpected>,
): Scorer<TInput, TExpected> {
  if (!options.id.trim() || !options.rubric.trim() || !options.rubricVersion.trim()) {
    throw new EvalError("judge id, rubric, and rubricVersion are required", "ERR_PRISM_EVAL_JUDGE");
  }
  const timeoutMs = bounded(options.timeoutMs, DEFAULT_JUDGE_TIMEOUT_MS, HARD_JUDGE_TIMEOUT_MS, "timeoutMs");
  const maxAttempts = bounded(options.maxAttempts, DEFAULT_JUDGE_MAX_ATTEMPTS, HARD_JUDGE_MAX_ATTEMPTS, "maxAttempts");
  const maxOutputBytes = bounded(options.maxOutputBytes, DEFAULT_JUDGE_MAX_OUTPUT_BYTES, HARD_JUDGE_MAX_OUTPUT_BYTES, "maxOutputBytes");
  const maxInputBytes = bounded(options.maxInputBytes, DEFAULT_JUDGE_MAX_INPUT_BYTES, HARD_JUDGE_MAX_INPUT_BYTES, "maxInputBytes");
  const maxRubricBytes = bounded(options.maxRubricBytes, DEFAULT_JUDGE_MAX_RUBRIC_BYTES, HARD_JUDGE_MAX_RUBRIC_BYTES, "maxRubricBytes");
  if (Buffer.byteLength(options.rubric) > maxRubricBytes) throw new EvalError("model judge rubric byte limit exceeded", "ERR_PRISM_EVAL_JUDGE_BOUNDS");

  return {
    id: options.id,
    description: `model judge rubric ${options.rubricVersion}`,
    async score(input) {
      let last: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error("model judge timeout")), timeoutMs);
        const abort = () => controller.abort(input.signal?.reason);
        input.signal?.addEventListener("abort", abort, { once: true });
        try {
          input.signal?.throwIfAborted();
          if (Buffer.byteLength(JSON.stringify({ target: input.target ?? { result: input.result }, item: input.item })) > maxInputBytes) {
            throw new EvalError("model judge input byte limit exceeded", "ERR_PRISM_EVAL_JUDGE_BOUNDS");
          }
          const request = options.judge({
            rubric: options.rubric,
            rubricVersion: options.rubricVersion,
            target: input.target ?? { result: input.result },
            item: input.item,
            signal: controller.signal,
          });
          const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener(
            "abort",
            () => reject(controller.signal.reason ?? new Error("model judge aborted")),
            { once: true },
          ));
          const result = validateScoreResult(await Promise.race([request, aborted]));
          if (Buffer.byteLength(JSON.stringify(result)) > maxOutputBytes) {
            throw new EvalError("model judge output byte limit exceeded", "ERR_PRISM_EVAL_JUDGE_BOUNDS");
          }
          return { ...result, metadata: { ...result.metadata, evaluatorKind: "model", rubricVersion: options.rubricVersion } };
        } catch (error) {
          last = error;
          if (input.signal?.aborted || attempt === maxAttempts) throw error;
        } finally {
          clearTimeout(timer);
          input.signal?.removeEventListener("abort", abort);
        }
      }
      throw last;
    },
  };
}
