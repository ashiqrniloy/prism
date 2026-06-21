import type { AIProvider, ModelConfig, ProviderRequestOptions, ToolDefinition } from "prism";
import { type MemoryObservation } from "../types.js";
import { runMemoryWorkerLoop } from "../worker-loop.js";

export interface RunDropperOptions {
  readonly observations: readonly MemoryObservation[];
  readonly targetTokens: number;
  readonly provider: AIProvider;
  readonly model: ModelConfig;
  readonly maxTurns: number;
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

export async function runDropper(options: RunDropperOptions): Promise<readonly string[]> {
  const active = [...options.observations];
  const total = active.reduce((sum, item) => sum + item.tokenCount, 0);
  if (total <= options.targetTokens) return [];
  const dropped = new Set<string>();
  const allowed = new Set(active.map((item) => item.id));
  const tool: ToolDefinition = {
    name: "drop_observations",
    description: "Drop observation ids that are redundant or low value.",
    parameters: { type: "object" },
    execute(args, context) {
      const ids = Array.isArray(args.observationIds) ? args.observationIds.filter((id): id is string => typeof id === "string" && allowed.has(id)) : [];
      for (const id of ids) dropped.add(id);
      return { toolCallId: context.toolCallId, name: "drop_observations", value: { ok: true } };
    },
  };
  const prompt = active.map((item) => `[${item.id}] (${item.tokenCount}) ${item.content}`).join("\n");
  await runMemoryWorkerLoop({ ...options, system: `Drop enough observations to approach ${options.targetTokens} tokens. Call drop_observations.`, prompt, tools: [tool] });
  return [...dropped];
}
