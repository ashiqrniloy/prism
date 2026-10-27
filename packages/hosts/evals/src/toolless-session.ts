import type { Agent } from "@arnilo/prism";
import { EvalError } from "./errors.js";
import { HARD_JUDGE_MAX_INPUT_BYTES } from "./limits.js";

/** @internal One attempt; the host retains ownership of the agent. */
export async function runToollessSession(agent: Agent, prompt: string, signal: AbortSignal, timeoutMs: number): Promise<string> {
  signal.throwIfAborted();
  const session = await agent.session();
  try {
    signal.throwIfAborted();
    const result = await session.run(prompt, {
      signal,
      tools: { only: [] },
      limits: { maxTurns: 1, maxProviderAttempts: 1, maxToolCalls: 1, maxToolRounds: 1,
        maxContinuations: 0, maxWallTimeMs: timeoutMs, maxInputTokens: HARD_JUDGE_MAX_INPUT_BYTES,
        maxOutputTokens: 4096, maxTotalTokens: HARD_JUDGE_MAX_INPUT_BYTES + 4096 },
    });
    if (result.status !== "completed") {
      throw new EvalError("judge run did not complete", "ERR_PRISM_EVAL_JUDGE_OUTPUT");
    }
    return result.text;
  } finally { await session.close(); }
}

