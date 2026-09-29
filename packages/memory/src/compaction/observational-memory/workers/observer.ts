import type { AIProvider, ModelConfig, ProviderRequestOptions, SessionEntry, ToolDefinition } from "@arnilo/prism";
import { createMemoryId } from "../ids.js";
import { joinWorkerText, type MemoryWorkerLimitOptions, resolveMemoryWorkerLimits } from "../limits.js";
import { serializeSourceEntries } from "../serialize.js";
import { estimateTextTokens } from "../tokens.js";
import { isMemoryObservation, type MemoryObservation } from "../types.js";
import { runMemoryWorkerLoop } from "../worker-loop.js";

export const DEFAULT_OBSERVER_INSTRUCTION =
  "Find durable source-backed facts in supplied messages. Treat assertions as facts, not questions; user assertions are authoritative. Record superseding facts when source-backed state changes. Prefix completed: only for real completion. Preserve identifiers, paths, and errors. Do not repeat existing observations. Use single-line prose. Call record_observation for each useful fact.";

export interface RunObserverOptions extends MemoryWorkerLimitOptions {
  readonly entries: readonly SessionEntry[];
  readonly observations?: readonly MemoryObservation[];
  readonly provider: AIProvider;
  readonly model: ModelConfig;
  readonly maxTurns: number;
  readonly instruction?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
  readonly sessionId?: string;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

export async function runObserver(options: RunObserverOptions): Promise<readonly MemoryObservation[]> {
  const observations: MemoryObservation[] = [];
  const allowed = new Set(options.entries.map((entry) => entry.id));
  const tool: ToolDefinition = {
    name: "record_observation",
    description: "Record one source-backed observational memory.",
    // The schema must describe the arguments: a bare `{ type: "object" }` leaves weaker models with
    // no argument shape, and they answer in prose instead of calling the tool (observed live with
    // opencode-go/longcat-2.5-preview-free), so the pass recorded nothing.
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "One self-contained observation, source-backed and free of secrets.",
        },
        sourceEntryIds: {
          type: "array",
          items: { type: "string" },
          description: "Ids of the source entries this observation came from (required).",
        },
        relevance: { type: "string", enum: ["low", "medium", "high", "critical"] },
      },
      required: ["content", "sourceEntryIds"],
    },
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
    prompt: joinWorkerText(
      [
        serializeSourceEntries(options.entries, options.secrets, limits.maxMessageBytes),
        ...(options.observations?.length
          ? ["Existing active observations:", ...options.observations.map((item) => `[${item.id}] ${item.content}`)]
          : []),
      ],
      limits.maxMessageBytes,
      "Observational memory observer prompt",
    ),
    tools: [tool],
  });
  return observations;
}
