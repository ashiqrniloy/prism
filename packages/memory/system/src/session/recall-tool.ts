/**
 * The `recall` tool: exact-id memory lookup plus raw-source paging over the current branch.
 *
 * Registered with `when: on`, so a session with observational memory off neither sees the tool nor
 * can call it. Entries come from the executing session itself (`ToolExecutionContext.session`), so the
 * tool can only read its own session's branch. Chunks are read through the package's chunk store handle with the
 * executing session's id, so a chunk only another session references reads as gone.
 */
import type { JsonObject, ToolDefinition, ToolResult } from "@arnilo/prism";

import type { ChunkStoreHandle } from "../chunks.js";
import { isMemoryId } from "./ids.js";
import { foldObservationalMemoryLedger } from "./ledger.js";
import { DEFAULT_RECALL_PAGE_LIMIT } from "./limits.js";
import { type RecallChunkTexts, recallObservationalMemory, recallObservationalMemoryBranchPage } from "./recall.js";

export interface RecallToolOptions {
  readonly name?: string;
  /** The page size when the call carries none. Default {@link DEFAULT_RECALL_PAGE_LIMIT}. */
  readonly pageLimit?: number;
  /** The package's chunk store. Without it, recall lists a record's chunk refs without their text. */
  readonly chunks?: ChunkStoreHandle;
}

export function createObservationalRecallTool(options: RecallToolOptions = {}): ToolDefinition {
  const name = options.name ?? "recall";
  return {
    name,
    description:
      "Recall a session memory record by exact 12-character id (its description, kind, time, count, source ids and verbatim chunks; detail full adds the raw source entries), or page current-branch user/assistant/tool messages around a cursor entry id.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Exact 12-character observational-memory id." },
        cursor: { type: "string", description: "Current-branch message entry id for raw-source paging." },
        limit: { type: "integer", description: "Page size; defaults to the package's page limit." },
        direction: { type: "string", enum: ["forward", "backward"] },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description: "With id: full adds the raw source entries. With cursor: full serializes whole entries.",
        },
      },
    } as JsonObject,
    async execute(args, context): Promise<ToolResult> {
      const fail = (
        value: { readonly found: false; readonly reason: string; readonly text: string } & Record<string, unknown>,
      ): ToolResult => ({
        toolCallId: context.toolCallId,
        name,
        value,
        content: [{ type: "text", text: value.text }],
      });
      const session = context.session;
      if (!session) return fail({ found: false, reason: "no_session", text: "Recall needs the executing session." });

      const hasId = typeof args.id === "string" && args.id.length > 0;
      const hasCursor = typeof args.cursor === "string" && args.cursor.trim().length > 0;
      if (hasId === hasCursor) return fail({ found: false, reason: "invalid_request", text: "Provide exactly one of id or cursor." });

      const entries = await session.entries();
      if (hasId) {
        const id = args.id as string;
        if (!isMemoryId(id)) {
          return fail({ found: false, id, reason: "invalid_id", text: "Invalid memory id; expected 12 lowercase hex characters." });
        }
        const ledger = foldObservationalMemoryLedger(entries);
        const refs = ledger.observations.find((item) => item.id === id)?.chunkRefs ?? [];
        let chunkTexts: RecallChunkTexts | undefined;
        if (refs.length && options.chunks) {
          const read = new Map<string, { readonly text: string } | undefined>();
          // A store that cannot be read leaves the chunks listed as not read rather than reported dropped.
          chunkTexts = await options.chunks
            .run(async (store) => {
              for (const ref of refs) read.set(ref.id, await store.get(ref.id, session.id));
            })
            .then(
              () => read,
              () => undefined,
            );
        }
        const value = recallObservationalMemory(entries, id, [], {
          ledger,
          detail: args.detail === "full" ? "full" : "summary",
          ...(chunkTexts ? { chunkTexts } : {}),
        });
        return { toolCallId: context.toolCallId, name, value, content: [{ type: "text", text: value.text }] };
      }

      const value = recallObservationalMemoryBranchPage(entries, {
        cursor: (args.cursor as string).trim(),
        limit: typeof args.limit === "number" ? args.limit : (options.pageLimit ?? DEFAULT_RECALL_PAGE_LIMIT),
        direction: args.direction === "forward" ? "forward" : "backward",
        detail: args.detail === "full" ? "full" : "summary",
      });
      return { toolCallId: context.toolCallId, name, value, content: [{ type: "text", text: value.text }] };
    },
  };
}
