import type { ModelClient, ProviderRequestOptions, ToolDefinition } from "@arnilo/prism";
import { createMemoryId } from "../ids.js";
import { joinWorkerText, type MemoryWorkerLimitOptions, resolveMemoryWorkerLimits } from "../limits.js";
import { estimateTextTokens } from "../tokens.js";
import { isMemoryReflection, type MemoryObservation, type MemoryReflection } from "../types.js";
import { runMemoryWorkerLoop } from "../worker-loop.js";

export const DEFAULT_REFLECTOR_INSTRUCTION =
  "Rewrite the entire memory log from existing reflections and new observations. Preserve durable knowledge and cite its underlying observation ids with record_reflection.";

export interface RunReflectorOptions extends MemoryWorkerLimitOptions {
  readonly observations: readonly MemoryObservation[];
  readonly reflections?: readonly MemoryReflection[];
  readonly client: ModelClient;
  readonly maxTurns: number;
  readonly instruction?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
  readonly sessionId?: string;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

export async function runReflector(options: RunReflectorOptions): Promise<readonly MemoryReflection[]> {
  const reflections: MemoryReflection[] = [];
  const allowed = new Set([
    ...options.observations.map((item) => item.id),
    ...(options.reflections ?? []).flatMap((item) => item.supportingObservationIds),
  ]);
  const tool: ToolDefinition = {
    name: "record_reflection",
    description: "Record one durable reflection supported by observation ids.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: { type: "string", minLength: 1 },
        supportingObservationIds: { type: "array", minItems: 1, items: { type: "string", pattern: "^[a-f0-9]{12}$" } },
      },
      required: ["content", "supportingObservationIds"],
    },
    execute(args, context) {
      const content = typeof args.content === "string" ? args.content.replace(/\s+/g, " ").trim() : "";
      const supportingObservationIds = Array.isArray(args.supportingObservationIds)
        ? args.supportingObservationIds.filter((id): id is string => typeof id === "string" && allowed.has(id))
        : [];
      const dates = supportingObservationIds
        .flatMap((id) => {
          const observation = options.observations.find((item) => item.id === id);
          if (observation) return [observation.observedAt ?? observation.timestamp];
          return (options.reflections ?? [])
            .filter((item) => item.supportingObservationIds.includes(id))
            .flatMap((item) => [item.observedFrom, item.observedTo].filter((date): date is string => date !== undefined));
        })
        .filter((date) => Number.isFinite(Date.parse(date)))
        .map((date) => new Date(date).toISOString())
        .sort();
      const reflection = {
        ...(dates.length ? { observedFrom: dates[0], observedTo: dates.at(-1) } : {}),
        id: createMemoryId(content, supportingObservationIds),
        content,
        supportingObservationIds,
        tokenCount: estimateTextTokens(content),
      };
      if (supportingObservationIds.length && isMemoryReflection(reflection)) reflections.push(reflection);
      return { toolCallId: context.toolCallId, name: "record_reflection", value: { ok: true } };
    },
  };
  const limits = resolveMemoryWorkerLimits(options);
  const prompt = joinWorkerText(
    memoryLines(options.observations, options.reflections ?? []),
    limits.maxMessageBytes,
    "Observational memory reflection prompt",
  );
  const system = options.instruction ? `${DEFAULT_REFLECTOR_INSTRUCTION}\n\n${options.instruction}` : DEFAULT_REFLECTOR_INSTRUCTION;
  await runMemoryWorkerLoop({
    ...options,
    system,
    prompt,
    tools: [tool],
  });
  return reflections;
}

function* memoryLines(observations: readonly MemoryObservation[], reflections: readonly MemoryReflection[]): Generator<string> {
  for (const item of reflections) yield `Reflection [${item.id}] supporting: ${item.supportingObservationIds.join(", ")} ${item.content}`;
  for (const item of observations) yield `[${item.id}] ${item.observedAt ?? item.timestamp} ${item.content}`;
}
