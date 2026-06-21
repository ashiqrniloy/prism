import type { AIProvider, ModelConfig, ProviderRequestOptions, ToolDefinition } from "prism";
import { createMemoryId } from "../ids.js";
import { estimateTextTokens } from "../tokens.js";
import { isMemoryReflection, type MemoryObservation, type MemoryReflection } from "../types.js";
import { runMemoryWorkerLoop } from "../worker-loop.js";

export interface RunReflectorOptions {
  readonly observations: readonly MemoryObservation[];
  readonly provider: AIProvider;
  readonly model: ModelConfig;
  readonly maxTurns: number;
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

export async function runReflector(options: RunReflectorOptions): Promise<readonly MemoryReflection[]> {
  const reflections: MemoryReflection[] = [];
  const allowed = new Set(options.observations.map((item) => item.id));
  const tool: ToolDefinition = {
    name: "record_reflection",
    description: "Record one durable reflection supported by observation ids.",
    parameters: { type: "object" },
    execute(args, context) {
      const content = typeof args.content === "string" ? args.content.replace(/\s+/g, " ").trim() : "";
      const supportingObservationIds = Array.isArray(args.supportingObservationIds) ? args.supportingObservationIds.filter((id): id is string => typeof id === "string" && allowed.has(id)) : [];
      const reflection = { id: createMemoryId(content, supportingObservationIds), content, supportingObservationIds, tokenCount: estimateTextTokens(content) };
      if (supportingObservationIds.length && isMemoryReflection(reflection)) reflections.push(reflection);
      return { toolCallId: context.toolCallId, name: "record_reflection", value: { ok: true } };
    },
  };
  const prompt = options.observations.map((item) => `[${item.id}] ${item.content}`).join("\n");
  await runMemoryWorkerLoop({ ...options, system: "Distill durable reflections from observations. Call record_reflection with supporting observation ids.", prompt, tools: [tool] });
  return reflections;
}
