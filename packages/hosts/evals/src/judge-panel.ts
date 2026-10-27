import { EvalError } from "./errors.js";
import type { JudgePanelOptions, Scorer } from "./types.js";
import { validateScoreResult } from "./util.js";

/** Compose judges without adding model calls, retries, or changing their scorer input. */
export function createJudgePanel<TInput = unknown, TExpected = unknown>(
  options: JudgePanelOptions<TInput, TExpected>,
): Scorer<TInput, TExpected> {
  const { id, combine, requireDistinctModels = true } = options;
  const judges = [...options.judges];
  const fail = (message: string) => new EvalError(message, "ERR_PRISM_EVAL_JUDGE_PANEL");
  if (typeof id !== "string" || !id.trim() || !judges.length ||
    !["majority", "mean", "median"].includes(combine) || typeof requireDistinctModels !== "boolean" ||
    judges.some(judge => !judge || typeof judge.id !== "string" || !judge.id.trim() || typeof judge.score !== "function")) {
    throw fail("panel requires an id, judges, and a valid combine method");
  }
  if (requireDistinctModels) {
    const models = new Set<string>();
    for (const judge of judges) {
      const model = judge.judgeModel;
      if (!model || typeof model.provider !== "string" || !model.provider.trim() ||
        typeof model.model !== "string" || !model.model.trim()) {
        throw fail("distinct-model panels require every judge to declare judgeModel");
      }
      const key = JSON.stringify([model.provider, model.model]);
      if (models.has(key)) throw fail("panel judges must use distinct models");
      models.add(key);
    }
  }
  const requires = [...new Set(judges.flatMap(judge => judge.requires ?? []))];
  return {
    id,
    ...(requires.length ? { requires } : {}),
    async score(input) {
      input.signal?.throwIfAborted();
      const verdicts = await Promise.all(judges.map(async judge => {
        try {
          const result = validateScoreResult(await judge.score(input));
          const label = result.metadata?.label;
          if (combine === "majority" && (typeof label !== "string" || !label.trim())) {
            throw fail("majority judges must return a label");
          }
          return { id: judge.id, model: result.metadata?.judgeModel ?? judge.judgeModel,
            label: typeof label === "string" && label.trim() ? label : null,
            score: result.score, status: "scored" as const };
        } catch {
          // Member errors may contain raw prompt text; retain only identity and failure status.
          return { id: judge.id, model: judge.judgeModel, label: null, status: "failed" as const };
        }
      }));
      input.signal?.throwIfAborted();
      const successes = verdicts.filter(verdict => verdict.status === "scored");
      const failedJudges = judges.length - successes.length;
      if (successes.length < judges.length / 2) {
        throw fail(`panel quorum failed: ${failedJudges} of ${judges.length} judges failed`);
      }
      let score: number;
      let label: string | undefined;
      if (combine === "majority") {
        const votes = new Map<string, { count: number; score: number }>();
        for (const verdict of successes) {
          const vote = votes.get(verdict.label!) ?? { count: 0, score: verdict.score };
          vote.count++;
          vote.score = Math.min(vote.score, verdict.score);
          votes.set(verdict.label!, vote);
        }
        const winner = [...votes].sort(([a, x], [b, y]) => y.count - x.count || x.score - y.score || a.localeCompare(b))[0]!;
        label = winner[0];
        score = winner[1].score;
      } else {
        const scores = successes.map(verdict => verdict.score).sort((a, b) => a - b);
        const middle = Math.floor(scores.length / 2);
        score = combine === "mean" ? scores.reduce((sum, value) => sum + value, 0) / scores.length
          : scores.length % 2 ? scores[middle]! : (scores[middle - 1]! + scores[middle]!) / 2;
      }
      return { score, metadata: { evaluatorKind: "panel", combine, judges: verdicts,
        labels: verdicts.map(verdict => verdict.label), failedJudges, ...(label === undefined ? {} : { label }) } };
    },
  };
}
