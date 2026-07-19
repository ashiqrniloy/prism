import type { AIProvider, ModelConfig, ProviderRequestOptions, ToolDefinition } from "@arnilo/prism";
import { joinWorkerText, resolveMemoryWorkerLimits, type MemoryWorkerLimitOptions } from "../limits.js";
import { type MemoryObservation } from "../types.js";
import { runMemoryWorkerLoop } from "../worker-loop.js";

export interface RunDropperOptions extends MemoryWorkerLimitOptions {
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
  const limits = resolveMemoryWorkerLimits(options);
  const prompt = joinWorkerText(observationLines(active), limits.maxMessageBytes, "Observational memory drop prompt");
  await runMemoryWorkerLoop({ ...options, system: `Drop enough observations to approach ${options.targetTokens} tokens. Call drop_observations.`, prompt, tools: [tool] });
  return [...dropped];
}

function* observationLines(observations: readonly MemoryObservation[]): Generator<string> {
  for (const item of observations) yield `[${item.id}] (${item.tokenCount}) ${item.content}`;
}
