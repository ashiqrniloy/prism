import { assertFiniteUnitInterval } from "./util.js";
import { EvalError } from "./errors.js";
import type { DefineScorerInput, Scorer } from "./types.js";

/** Create a deterministic function scorer. */
export function defineScorer<TInput = unknown, TExpected = unknown>(
  input: DefineScorerInput<TInput, TExpected>,
): Scorer<TInput, TExpected> {
  const id = input.id.trim();
  if (!id) throw new EvalError("scorer id is required", "ERR_PRISM_EVAL_SCORER");
  if (input.passThreshold !== undefined) assertFiniteUnitInterval(input.passThreshold, "passThreshold");
  return {
    id,
    judgeModel: input.judgeModel,
    description: input.description,
    requires: input.requires,
    invariant: input.invariant,
    passThreshold: input.passThreshold,
    score: input.score,
  };
}
