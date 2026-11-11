import type { PackageAPI } from "@arnilo/prism";
import { callKey, consultPrompt, generateText, renderSlice, sliceOf, type AdvisorRuntime } from "./consult.js";
import type { AdvisorConfig } from "./config.js";
import { ADVICE_JSON_INSTRUCTION, eventData, parseAdviceVerdict } from "./verdict.js";

/** The `tool.call` and `run.end` review consults. Both fail open: an advisor outage must not block work. */
const REASON = "Advisor review";

/**
 * `beforeTools`: one consult before each listed tool. `revise` denies the call so the model reads the
 * advice as the tool result; a retry of the same tool with the same arguments is allowed without a second
 * consult, so a revise cannot loop. Every failure (error, timeout, unparseable answer, cap) allows.
 */
export function registerBeforeTools(prism: PackageAPI<AdvisorConfig>, runtime: AdvisorRuntime, names: readonly string[]): void {
  const listed = new Set(names);
  prism.hooks.on("tool.call", async (payload, context) => {
    if (!listed.has(payload.name)) return undefined;
    const key = callKey(payload.name, payload.args);
    if (runtime.ledger.wasRevised(payload.runId, key)) return "allow";
    if (!runtime.ledger.take(payload.runId)) {
      context.emit("advisor.consult", eventData({ trigger: "beforeTools", status: "capped" }));
      return "allow";
    }
    try {
      const entries = context.session === undefined ? [] : await context.session.entries();
      const transcript = renderSlice(sliceOf(entries, runtime.context));
      const args = JSON.stringify(payload.args).slice(0, 2_000);
      const question = `The agent is about to call the tool "${payload.name}" with these arguments:\n${args}\n\nShould it proceed, or change approach first? ${ADVICE_JSON_INSTRUCTION}`;
      const answer = await generateText(runtime.client, consultPrompt(runtime.instructions, transcript, question), {
        maxChars: runtime.adviceMaxChars,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      const verdict = parseAdviceVerdict(answer.text, runtime.adviceMaxChars);
      if (verdict === undefined) {
        context.emit("advisor.consult", eventData({ trigger: "beforeTools", status: "skipped" }));
        return "allow";
      }
      context.emit(
        "advisor.consult",
        eventData({
          trigger: "beforeTools",
          status: "ok",
          verdict: verdict.verdict,
          ...(answer.totalTokens === undefined ? {} : { totalTokens: answer.totalTokens }),
        }),
      );
      if (verdict.verdict === "proceed") return "allow";
      runtime.ledger.markRevised(payload.runId, key);
      return { deny: `Advisor: ${verdict.advice}` };
    } catch {
      context.emit("advisor.consult", eventData({ trigger: "beforeTools", status: "skipped" }));
      return "allow";
    }
  });
}

/**
 * `beforeFinish`: one consult at the natural end of the run. `revise` continues the loop with the advice
 * as the steer; every failure ends the run normally. Bounded by `maxConsultsPerRun` and the kernel's
 * `limits.maxContinuations`.
 */
export function registerBeforeFinish(prism: PackageAPI<AdvisorConfig>, runtime: AdvisorRuntime): void {
  prism.hooks.on("run.end", async (payload, context) => {
    if (!runtime.ledger.take(payload.runId)) {
      context.emit("advisor.consult", eventData({ trigger: "beforeFinish", status: "capped" }));
      return undefined;
    }
    try {
      const transcript = renderSlice(sliceOf(payload.history, runtime.context));
      const question = `The agent is about to finish. Its final answer is the last message. Review the work against the task: is anything important unfinished or wrong? ${ADVICE_JSON_INSTRUCTION}`;
      const answer = await generateText(runtime.client, consultPrompt(runtime.instructions, transcript, question), {
        maxChars: runtime.adviceMaxChars,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      const verdict = parseAdviceVerdict(answer.text, runtime.adviceMaxChars);
      if (verdict === undefined) {
        context.emit("advisor.consult", eventData({ trigger: "beforeFinish", status: "skipped" }));
        return undefined;
      }
      context.emit(
        "advisor.consult",
        eventData({
          trigger: "beforeFinish",
          status: "ok",
          verdict: verdict.verdict,
          ...(answer.totalTokens === undefined ? {} : { totalTokens: answer.totalTokens }),
        }),
      );
      if (verdict.verdict === "proceed") return undefined;
      return { continue: { reason: REASON, steer: verdict.advice } };
    } catch {
      context.emit("advisor.consult", eventData({ trigger: "beforeFinish", status: "skipped" }));
      return undefined;
    }
  });
}
