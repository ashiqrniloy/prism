import type { Agent } from "@arnilo/prism";
import { EvalError } from "./errors.js";

/** Input tokens allowed beyond the prompt itself, for the agent's system prompt. */
const SYSTEM_PROMPT_TOKEN_ALLOWANCE = 4096;

/** @internal One attempt; the host retains ownership of the agent. */
export async function runToollessSession(agent: Agent, prompt: string, signal: AbortSignal, timeoutMs: number): Promise<string> {
  signal.throwIfAborted();
  // The caller bounded the prompt by its host-set `maxInputBytes`; a token is at least one byte, plus room for the system prompt.
  const inputTokens = Buffer.byteLength(prompt, "utf8") + SYSTEM_PROMPT_TOKEN_ALLOWANCE;
  const session = await agent.session();
  try {
    signal.throwIfAborted();
    const result = await session.run(prompt, {
      signal,
      tools: { only: [] },
      limits: {
        maxTurns: 1,
        maxProviderAttempts: 1,
        maxToolCalls: 1,
        maxToolRounds: 1,
        maxContinuations: 0,
        maxWallTimeMs: timeoutMs,
        maxInputTokens: inputTokens,
        maxOutputTokens: 4096,
        maxTotalTokens: inputTokens + 4096,
      },
    });
    if (result.status !== "completed") {
      throw new EvalError("judge run did not complete", "ERR_PRISM_EVAL_JUDGE_OUTPUT");
    }
    return result.text;
  } finally {
    await session.close();
  }
}
