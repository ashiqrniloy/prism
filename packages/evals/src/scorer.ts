import { EvalError } from "./errors.js";
import type { DefineScorerInput, Scorer } from "./types.js";

/** Create a deterministic function scorer. */
export function defineScorer<TInput = unknown, TExpected = unknown>(
  input: DefineScorerInput<TInput, TExpected>,
): Scorer<TInput, TExpected> {
  const id = input.id.trim();
  if (!id) throw new EvalError("scorer id is required", "ERR_PRISM_EVAL_SCORER");
  return {
    id,
    description: input.description,
    score: input.score,
  };
}
