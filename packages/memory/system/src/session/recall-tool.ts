/**
 * The `recall` tool: exact-id memory lookup, a lexical query over this session's STM records and WM items (discarded ones
 * included, plan 218.2 Task 7), raw-source paging over the current branch, and one original entry paged by byte offset
 * (plan 218.3 Task 4).
 *
 * Registered with `when: on`, so a session with observational memory off neither sees the tool nor
 * can call it. Entries come from the executing session itself (`ToolExecutionContext.session`), so the
 * tool can only read its own session's branch. Originals are read from the session store, never from a copy; every
 * answer stays within the page bytes, and its `value` (what the model receives) names entries by id instead of
 * carrying them whole.
 */
import type { JsonObject, ToolDefinition, ToolResult } from "@arnilo/prism";

import { isMemoryId } from "./ids.js";
import { DEFAULT_RECALL_PAGE_LIMIT, resolveRecallPageBytes } from "./limits.js";
import {
  recallObservationalMemory,
  recallObservationalMemoryBranchPage,
  recallObservationalMemoryEntryPage,
  recallObservationalMemoryQuery,
} from "./recall.js";

export interface RecallToolOptions {
  readonly name?: string;
  /** The page size when the call carries none. Default {@link DEFAULT_RECALL_PAGE_LIMIT}. */
  readonly pageLimit?: number;
  /** Bytes one answer may carry. Default 16_384 (`DEFAULT_RECALL_PAGE_BYTES`), at least 1_024. */
  readonly pageBytes?: number;
  /** Ceiling on the model's `limit`. Default 100 (`DEFAULT_MAX_RECALL_PAGE_LIMIT`). */
  readonly maxPageLimit?: number;
  /** The executing session's secrets; query and id results are redacted with them again on output. */
  readonly secretsFor?: (sessionId: string) => readonly (string | undefined)[];
}

export function createObservationalRecallTool(options: RecallToolOptions = {}): ToolDefinition {
  const name = options.name ?? "recall";
  const pageBytes = resolveRecallPageBytes(options.pageBytes);
  const maxPageLimit = options.maxPageLimit;
  if (maxPageLimit !== undefined && (!Number.isSafeInteger(maxPageLimit) || maxPageLimit < 1))
    throw new RangeError("maxPageLimit must be a positive safe integer");
  return {
    name,
    description:
      "Recall session memory. Give exactly one of: id (an exact 12-character record id: its description, kind, time, count and source entry ids; detail full adds the original source entries); query (search terms over this session's memory record descriptions, records working memory discarded included; returns ids, kinds, times, states and descriptions); cursor (a current-branch message entry id: page user/assistant/tool messages around it); or entry (a message entry id: its original content, verbatim, one page at a time from offset).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Exact 12-character observational-memory id." },
        query: {
          type: "string",
          description: "Search terms; finds this session's memory records, discarded ones included, by their descriptions.",
        },
        cursor: { type: "string", description: "Current-branch message entry id for raw-source paging." },
        entry: { type: "string", description: "A message entry id (from sources, a cursor page or a page header): its original content." },
        offset: { type: "integer", description: "With entry: the byte offset to read from (a page names the next one). Default 0." },
        limit: {
          type: "integer",
          description: "With query: hits to return (default 8). With cursor: page size in messages. With entry: page bytes.",
        },
        direction: { type: "string", enum: ["forward", "backward"] },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description: "With id: full adds the original source entries. With cursor: full shows the original entries.",
        },
      },
    } as JsonObject,
    async execute(args, context): Promise<ToolResult> {
      const answer = (value: { readonly text: string } & Record<string, unknown>): ToolResult => ({
        toolCallId: context.toolCallId,
        name,
        value,
        content: [{ type: "text", text: value.text }],
      });
      const session = context.session;
      if (!session) return answer({ found: false, reason: "no_session", text: "Recall needs the executing session." });

      const present = (key: string) => typeof args[key] === "string" && (args[key] as string).trim().length > 0;
      const modes = ["id", "cursor", "query", "entry"].filter(present);
      if (modes.length !== 1)
        return answer({ found: false, reason: "invalid_request", text: "Provide exactly one of id, cursor, query or entry." });

      const entries = await session.entries();
      const secrets = options.secretsFor?.(session.id) ?? [];
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      switch (modes[0]) {
        case "query":
          return answer({
            ...recallObservationalMemoryQuery(
              entries,
              { query: args.query as string, ...(limit === undefined ? {} : { limit }) },
              secrets,
              { pageBytes, ...(maxPageLimit === undefined ? {} : { maxPageLimit }) },
            ),
          });
        case "entry": {
          // The model receives the value: the page travels once, in `text` (plan 218.3 Task 12; `content` doubled it).
          const { content: _page, ...page } = recallObservationalMemoryEntryPage(
            entries,
            {
              entry: args.entry as string,
              ...(typeof args.offset === "number" ? { offset: args.offset } : {}),
              ...(limit === undefined ? {} : { limit }),
            },
            secrets,
            { pageBytes },
          );
          return answer(page);
        }
        case "id": {
          const id = args.id as string;
          if (!isMemoryId(id))
            return answer({ found: false, id, reason: "invalid_id", text: "Invalid memory id; expected 12 lowercase hex characters." });
          const { sourceEntries, ...value } = recallObservationalMemory(entries, id, secrets, {
            detail: args.detail === "full" ? "full" : "summary",
            pageBytes,
          });
          return answer({ ...value, ...(sourceEntries ? { sourceEntryIds: sourceEntries.map((entry) => entry.id) } : {}) });
        }
        default: {
          const { entries: page, ...value } = recallObservationalMemoryBranchPage(
            entries,
            {
              cursor: (args.cursor as string).trim(),
              limit: limit ?? options.pageLimit ?? DEFAULT_RECALL_PAGE_LIMIT,
              direction: args.direction === "forward" ? "forward" : "backward",
              detail: args.detail === "full" ? "full" : "summary",
            },
            secrets,
            { pageBytes, ...(maxPageLimit === undefined ? {} : { maxPageLimit }) },
          );
          return answer({ ...value, entryIds: page.map((entry) => entry.id) });
        }
      }
    },
  };
}
