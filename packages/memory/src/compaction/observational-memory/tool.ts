import { type JsonObject, redactSecrets, type SessionEntry, type ToolDefinition, type ToolResult } from "@arnilo/prism";
import { isMemoryId } from "./ids.js";
import { DEFAULT_RECALL_PAGE_LIMIT } from "./limits.js";
import { recallObservationalMemory, recallObservationalMemoryBranchPage } from "./recall.js";

export type GetMemoryEntries = (sessionId: string) => Promise<readonly SessionEntry[]> | readonly SessionEntry[];

export interface RecallMemoryToolOptions {
  readonly name?: string;
  readonly getEntries: GetMemoryEntries;
  readonly secrets?: readonly (string | undefined)[];
  readonly pageLimit?: number;
}

export function createRecallMemoryTool(options: RecallMemoryToolOptions): ToolDefinition {
  const name = options.name ?? "recall";
  return {
    name,
    description:
      "Recall observational memory by exact 12-character id, or page current-branch user/assistant/tool messages around a cursor entry id.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Exact 12-character observational-memory id." },
        cursor: { type: "string", description: "Current-branch message entry id for raw-source paging." },
        limit: { type: "integer", description: "Page size; defaults to host pageLimit or 20." },
        direction: { type: "string", enum: ["forward", "backward"] },
        detail: { type: "string", enum: ["summary", "full"] },
        sessionId: { type: "string", description: "Ignored unless it disagrees with the active session." },
      },
    } as JsonObject,
    async execute(args, context) {
      const fail = (
        value: { readonly found: false; readonly reason: string; readonly text: string } & Record<string, unknown>,
      ): ToolResult => ({
        toolCallId: context.toolCallId,
        name,
        value,
        content: [{ type: "text", text: value.text }],
      });

      const requestedSessionId = typeof args.sessionId === "string" ? args.sessionId : undefined;
      if (requestedSessionId && requestedSessionId !== context.sessionId) {
        return fail({ found: false, reason: "wrong_session", text: "Session id does not match the active tool session." });
      }

      const hasId = typeof args.id === "string" && args.id.length > 0;
      const hasCursor = typeof args.cursor === "string" && args.cursor.trim().length > 0;
      if (hasId === hasCursor) {
        return fail({ found: false, reason: "invalid_request", text: "Provide exactly one of id or cursor." });
      }

      if (hasId) {
        const id = args.id as string;
        if (!isMemoryId(id)) {
          return fail({
            found: false,
            id,
            reason: "invalid_id",
            text: "Invalid memory id; expected 12 lowercase hex characters.",
          });
        }
        const entries = await options.getEntries(context.sessionId);
        if (entries.some((entry) => entry.sessionId !== context.sessionId)) {
          return fail({
            found: false,
            reason: "wrong_session",
            text: "Supplied entries include a different session id than the active tool session.",
          });
        }
        const value = JSON.parse(
          redactSecrets(JSON.stringify(recallObservationalMemory(entries, id, options.secrets)), options.secrets ?? []),
        );
        return { toolCallId: context.toolCallId, name, value, content: [{ type: "text", text: value.text }] };
      }

      const entries = await options.getEntries(context.sessionId);
      if (entries.some((entry) => entry.sessionId !== context.sessionId)) {
        return fail({
          found: false,
          reason: "wrong_session",
          text: "Supplied entries include a different session id than the active tool session.",
        });
      }

      const limit = typeof args.limit === "number" ? args.limit : (options.pageLimit ?? DEFAULT_RECALL_PAGE_LIMIT);
      const value = JSON.parse(
        redactSecrets(
          JSON.stringify(
            recallObservationalMemoryBranchPage(
              entries,
              {
                cursor: (args.cursor as string).trim(),
                limit,
                direction: args.direction === "forward" ? "forward" : "backward",
                detail: args.detail === "full" ? "full" : "summary",
              },
              options.secrets,
            ),
          ),
          options.secrets ?? [],
        ),
      );
      return { toolCallId: context.toolCallId, name, value, content: [{ type: "text", text: value.text }] };
    },
  };
}
