import { redactSecrets, type JsonObject, type SessionEntry, type ToolDefinition } from "prism";
import { isMemoryId } from "./ids.js";
import { recallObservationalMemory } from "./recall.js";

export type GetMemoryEntries = (sessionId: string) => Promise<readonly SessionEntry[]> | readonly SessionEntry[];

export interface RecallMemoryToolOptions {
  readonly name?: string;
  readonly getEntries: GetMemoryEntries;
  readonly secrets?: readonly (string | undefined)[];
}

export function createRecallMemoryTool(options: RecallMemoryToolOptions): ToolDefinition {
  const name = options.name ?? "recall";
  return {
    name,
    description: "Recall source evidence for a known 12-character observational-memory id. Exact id only; no semantic search.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } as JsonObject,
    async execute(args, context) {
      const id = typeof args.id === "string" ? args.id : "";
      if (!isMemoryId(id)) {
        const value = { found: false, id, reason: "invalid_id", text: "Invalid memory id; expected 12 lowercase hex characters." };
        return { toolCallId: context.toolCallId, name, value, content: [{ type: "text", text: value.text }] };
      }
      const entries = await options.getEntries(context.sessionId);
      const value = JSON.parse(redactSecrets(JSON.stringify(recallObservationalMemory(entries, id, options.secrets)), options.secrets ?? []));
      return { toolCallId: context.toolCallId, name, value, content: [{ type: "text", text: value.text }] };
    },
  };
}
