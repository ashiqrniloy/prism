import type { ModelClient, ProviderRequestOptions, SessionEntry, ToolDefinition } from "@arnilo/prism";
import { createMemoryId } from "../ids.js";
import { joinWorkerText, type MemoryWorkerLimitOptions, resolveMemoryWorkerLimits, truncateWorkerText } from "../limits.js";
import { serializeSourceEntries } from "../serialize.js";
import { estimateTextTokens } from "../tokens.js";
import type { ObservationalMemoryRecord } from "../ledger.js";
import {
  OBSERVATIONS_DROPPED,
  TASK_STATE_RECORDED,
  isIsoDate,
  isMemoryObservation,
  type MemoryTaskState,
  type MemoryObservation,
} from "../types.js";
import { runMemoryWorkerLoop } from "../worker-loop.js";

export const DEFAULT_OBSERVER_INSTRUCTION =
  "Find durable source-backed facts in supplied messages. Treat assertions as facts, not questions; user assertions are authoritative. Record superseding facts when source-backed state changes. Prefix completed: only for real completion. Preserve identifiers, paths, and errors. Do not repeat existing observations. Use single-line prose. Convert relative time references to absolute ISO dates using the source message time. Call record_observation for each useful fact, with supersedes when replacing an existing fact. Call record_task_state when the goal, open questions, decisions, or next steps change; list assumptions without user confirmation under openQuestions.";

export interface RunObserverOptions extends MemoryWorkerLimitOptions {
  readonly onRecord?: (record: ObservationalMemoryRecord) => void;
  readonly taskState?: MemoryTaskState;
  readonly entries: readonly SessionEntry[];
  readonly observations?: readonly MemoryObservation[];
  readonly client: ModelClient;
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
  const limits = resolveMemoryWorkerLimits(options);
  const known = new Set(options.observations?.map((item) => item.id) ?? []);
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
        referencedAt: { type: "string", description: "Absolute ISO date (YYYY-MM-DD) the fact refers to." },
        supersedes: { type: "string", description: "Existing observation id replaced by this fact." },
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
        observedAt: options.entries
          .filter((entry) => sourceEntryIds.includes(entry.id))
          .map((entry) => entry.timestamp)
          .sort((a, b) => Date.parse(a) - Date.parse(b))
          .at(-1),
        ...(isIsoDate(args.referencedAt) ? { referencedAt: args.referencedAt } : {}),
        relevance,
        sourceEntryIds,
        tokenCount: estimateTextTokens(content),
      };
      const valid = sourceEntryIds.length > 0 && isMemoryObservation(observation);
      const supersedes = typeof args.supersedes === "string" ? args.supersedes : undefined;
      const recognized = supersedes !== undefined && known.has(supersedes) && supersedes !== observation.id;
      if (valid) {
        observations.push(observation);
        known.add(observation.id);
        if (recognized) {
          options.onRecord?.({
            type: OBSERVATIONS_DROPPED,
            observationIds: [supersedes!],
            reason: "superseded",
            supersededBy: observation.id,
          });
          known.delete(supersedes!);
        }
      }
      return {
        toolCallId: context.toolCallId,
        name: "record_observation",
        value: { ok: valid, ...(supersedes && !recognized ? { warning: "Unknown supersedes id ignored" } : {}) },
      };
    },
  };
  const taskTool: ToolDefinition = {
    name: "record_task_state",
    description:
      "Replace the current task state with the goal, unresolved questions, decisions, and next steps grounded in supplied messages.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["goal"],
      properties: {
        goal: { type: "string", minLength: 1, maxLength: limits.maxTaskStateBytes },
        ...Object.fromEntries(
          ["openQuestions", "decisions", "nextSteps"].map((key) => [
            key,
            { type: "array", maxItems: 32, items: { type: "string", maxLength: limits.maxTaskStateBytes } },
          ]),
        ),
      },
    },
    execute(args, context) {
      if (
        typeof args.goal !== "string" ||
        !args.goal.trim() ||
        !allowed.size ||
        [args.openQuestions, args.decisions, args.nextSteps].some(
          (value) => value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string")),
        )
      ) {
        return { toolCallId: context.toolCallId, name: "record_task_state", value: { ok: false } };
      }
      let remaining = limits.maxTaskStateBytes;
      const bounded = (text: string): string => {
        const value = truncateWorkerText(text.replace(/\s+/g, " ").trim(), remaining);
        remaining -= Buffer.byteLength(value, "utf8");
        return value;
      };
      const goal = bounded(args.goal);
      const fields: { openQuestions?: string[]; decisions?: string[]; nextSteps?: string[] } = {};
      for (const key of ["openQuestions", "decisions", "nextSteps"] as const) {
        const value = args[key];
        if (Array.isArray(value))
          fields[key] = value
            .slice(0, 32)
            .map((item) => bounded(item as string))
            .filter(Boolean);
      }
      if (goal) {
        const sourceEntryIds = [...allowed];
        const taskState = { id: createMemoryId(JSON.stringify({ goal, ...fields }), sourceEntryIds), goal, ...fields, sourceEntryIds };
        options.onRecord?.({ type: TASK_STATE_RECORDED, taskState });
      }
      return { toolCallId: context.toolCallId, name: "record_task_state", value: { ok: Boolean(goal) } };
    },
  };
  const system = options.instruction ? `${DEFAULT_OBSERVER_INSTRUCTION}\n\n${options.instruction}` : DEFAULT_OBSERVER_INSTRUCTION;
  await runMemoryWorkerLoop({
    ...options,
    system,
    prompt: joinWorkerText(
      [
        ...(options.taskState ? ["Current task state:", JSON.stringify(options.taskState)] : []),
        serializeSourceEntries(options.entries, options.secrets, limits.maxMessageBytes),
        ...(options.observations?.length
          ? ["Existing active observations:", ...options.observations.map((item) => `[${item.id}] ${item.content}`)]
          : []),
      ],
      limits.maxMessageBytes,
      "Observational memory observer prompt",
    ),
    tools: [tool, taskTool],
  });
  return observations;
}
