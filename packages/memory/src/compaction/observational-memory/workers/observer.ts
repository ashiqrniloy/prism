import type { AIProvider, ModelConfig, ProviderRequestOptions, SessionEntry, ToolDefinition } from "@arnilo/prism";
import { createMemoryId } from "../ids.js";
import { type MemoryWorkerLimitOptions, resolveMemoryWorkerLimits } from "../limits.js";
import { serializeSourceEntries } from "../serialize.js";
import { estimateTextTokens } from "../tokens.js";
import { isMemoryObservation, type MemoryObservation } from "../types.js";
import { runMemoryWorkerLoop } from "../worker-loop.js";

export const DEFAULT_OBSERVER_INSTRUCTION =
  "Find durable source-backed facts from the supplied messages. Call record_observation for each useful fact.";

export interface RunObserverOptions extends MemoryWorkerLimitOptions {
  readonly entries: readonly SessionEntry[];
  readonly provider: AIProvider;
  readonly model: ModelConfig;
  readonly maxTurns: number;
  readonly instruction?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

export async function runObserver(options: RunObserverOptions): Promise<readonly MemoryObservation[]> {
  const observations: MemoryObservation[] = [];
  const allowed = new Set(options.entries.map((entry) => entry.id));
  const tool: ToolDefinition = {
    name: "record_observation",
    description: "Record one source-backed observational memory.",
    parameters: { type: "object" },
    execute(args, context) {
      const content = typeof args.content === "string" ? args.content.replace(/\s+/g, " ").trim() : "";
      const sourceEntryIds = Array.isArray(args.sourceEntryIds)
        ? args.sourceEntryIds.filter((id): id is string => typeof id === "string" && allowed.has(id))
        : [];
      const relevance = ["low", "medium", "high", "critical"].includes(String(args.relevance))
        ? (args.relevance as MemoryObservation["relevance"])
        : "medium";
      const observation = {
        id: createMemoryId(content, sourceEntryIds),
        content,
        timestamp: new Date().toISOString(),
        relevance,
        sourceEntryIds,
        tokenCount: estimateTextTokens(content),
      };
      if (sourceEntryIds.length && isMemoryObservation(observation)) observations.push(observation);
      return { toolCallId: context.toolCallId, name: "record_observation", value: { ok: true } };
    },
  };
  const limits = resolveMemoryWorkerLimits(options);
  const system = options.instruction ? `${DEFAULT_OBSERVER_INSTRUCTION}\n\n${options.instruction}` : DEFAULT_OBSERVER_INSTRUCTION;
  await runMemoryWorkerLoop({
    ...options,
    system,
    prompt: serializeSourceEntries(options.entries, options.secrets, limits.maxMessageBytes),
    tools: [tool],
  });
  return observations;
}
