import type { AIProvider, ModelConfig, ProviderRequestOptions, SessionEntry, ToolDefinition } from "@arnilo/prism";
import { createMemoryId } from "../ids.js";
import { serializeSourceEntries } from "../serialize.js";
import { estimateTextTokens } from "../tokens.js";
import { isMemoryObservation, type MemoryObservation } from "../types.js";
import { runMemoryWorkerLoop } from "../worker-loop.js";

export interface RunObserverOptions {
  readonly entries: readonly SessionEntry[];
  readonly provider: AIProvider;
  readonly model: ModelConfig;
  readonly maxTurns: number;
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
      const sourceEntryIds = Array.isArray(args.sourceEntryIds) ? args.sourceEntryIds.filter((id): id is string => typeof id === "string" && allowed.has(id)) : [];
      const relevance = ["low", "medium", "high", "critical"].includes(String(args.relevance)) ? args.relevance as MemoryObservation["relevance"] : "medium";
      const observation = { id: createMemoryId(content, sourceEntryIds), content, timestamp: new Date().toISOString(), relevance, sourceEntryIds, tokenCount: estimateTextTokens(content) };
      if (sourceEntryIds.length && isMemoryObservation(observation)) observations.push(observation);
      return { toolCallId: context.toolCallId, name: "record_observation", value: { ok: true } };
    },
  };
  await runMemoryWorkerLoop({ ...options, system: "Find durable source-backed facts from this coding session. Call record_observation for each useful fact.", prompt: serializeSourceEntries(options.entries, options.secrets), tools: [tool] });
  return observations;
}
