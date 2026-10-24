import type { JsonObject, PackageAPI, ToolDefinition, ToolResult } from "@arnilo/prism";
import { consultPrompt, generateText, renderSlice, sliceOf, type AdvisorRuntime } from "./consult.js";
import type { AdvisorConfig } from "./config.js";
import { eventData } from "./verdict.js";

export const ADVISE_TOOL = "advise";
export const ADVISE_DESCRIPTION =
  "Ask a second model for advice on your current approach. It sees the recent conversation; state the specific question.";

function failure(toolCallId: string, message: string): ToolResult {
  return { toolCallId, name: ADVISE_TOOL, error: { message } };
}

/** The `advise` tool: one model call over the branch slice, text result, capped per run. */
export function createAdviseTool(prism: PackageAPI<AdvisorConfig>, runtime: AdvisorRuntime): ToolDefinition {
  return {
    name: ADVISE_TOOL,
    exclusive: false,
    effects: ["external"],
    description: ADVISE_DESCRIPTION,
    parameters: {
      type: "object",
      properties: { question: { type: "string", minLength: 1, description: "The specific question or decision to second-guess." } },
      required: ["question"],
      additionalProperties: false,
    } as unknown as JsonObject,
    async execute(args, context) {
      if (typeof args.question !== "string" || args.question.trim().length === 0) {
        return failure(context.toolCallId, "question must be a non-empty string");
      }
      if (!runtime.ledger.take(context.runId)) {
        prism.events.emit("advisor.consult", eventData({ trigger: "tool", status: "capped" }));
        return failure(
          context.toolCallId,
          `The advisor cap for this run is reached (maxConsultsPerRun: ${runtime.maxConsultsPerRun}). Decide without it.`,
        );
      }
      try {
        const entries = context.session === undefined ? [] : await context.session.entries();
        const transcript = renderSlice(sliceOf(entries, runtime.context));
        const answer = await generateText(
          runtime.client,
          consultPrompt(runtime.instructions, transcript, args.question),
          { maxChars: runtime.adviceMaxChars, ...(context.signal === undefined ? {} : { signal: context.signal }) },
        );
        prism.events.emit(
          "advisor.consult",
          eventData({
            trigger: "tool",
            status: "ok",
            ...(answer.totalTokens === undefined ? {} : { totalTokens: answer.totalTokens }),
          }),
        );
        const tokens = answer.totalTokens === undefined ? "" : `, ${answer.totalTokens.toLocaleString("en-US")} tokens`;
        return {
          toolCallId: context.toolCallId,
          name: ADVISE_TOOL,
          content: [{ type: "text", text: `${answer.text || "(the advisor had nothing to add)"}\n\n[advisor: ${runtime.model.provider}/${runtime.model.model}${tokens}]` }],
        };
      } catch (error) {
        prism.events.emit("advisor.consult", eventData({ trigger: "tool", status: "skipped" }));
        const reason = error instanceof Error ? error.message : String(error);
        return failure(context.toolCallId, `The advisor did not answer: ${reason.slice(0, 200)}`);
      }
    },
  };
}
