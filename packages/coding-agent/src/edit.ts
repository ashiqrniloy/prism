/**
 * Edit tool: precise text replacement in an existing file via exact-then-fuzzy matching.
 *
 * Behavioral port of pi's core/tools/edit for @arnilo/prism-coding-agent, adapted to Prism's
 * `ToolDefinition` contract. Faithfully ports the access → read → stripBom → line-ending-normalize →
 * `applyEditsToNormalizedContent` (exact then fuzzy, with duplicate/overlap/empty/no-change guards) →
 * write flow, serialized per-path via `withFileMutationQueue`. Also ports `prepareEditArguments`
 * (tolerates models that send `edits` as a JSON string or as legacy top-level `oldText`/`newText`).
 *
 * Drops pi's TUI (`renderCall`/`renderResult`, live preview cache, theme/syntax-highlight).
 *
 * Deviations from pi (documented):
 *  - Abort + every failure (missing/unreadable file, no-match, duplicate, overlap, empty oldText,
 *    no-change) return a Prism `error` result (pi throws/rejects). On no-match the file is untouched
 *    because `applyEditsToNormalizedContent` throws before `writeFile`.
 *  - pi's per-tool `details: { diff, patch, firstChangedLine }` (TUI-facing) is surfaced as
 *    `ToolResult.metadata` (host-readable, keeps model context small — the model only sees the short
 *    `Successfully replaced N block(s)` confirmation).
 *  - The post-`writeFile` abort check is dropped (consistent with the write tool): if the write
 *    completed, the edit is real and is reported as success rather than a misleading "aborted".
 */
import { Buffer } from "node:buffer";
import {
  access as fsAccess,
  stat as fsStat,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import type {
  ExecutionPolicy,
  JsonObject,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import { readFileBounded } from "./bounded-file.js";
import { enforceExecutionPolicy } from "./execution-policy.js";
import { resolveToCwd } from "./path-utils.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import {
  DEFAULT_MAX_EDIT_FILE_BYTES,
  DEFAULT_MAX_EDIT_INPUT_BYTES,
  DEFAULT_MAX_EDITS,
  HARD_MAX_EDIT_FILE_BYTES,
  HARD_MAX_EDIT_INPUT_BYTES,
  HARD_MAX_EDITS,
  validateCodingLimit,
} from "./limits.js";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  generateDiffString,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./edit-diff.js";

export interface Edit {
  oldText: string;
  newText: string;
}

/** Display/result details mirrored from pi's `EditToolDetails`, surfaced via `ToolResult.metadata`. */
export interface EditToolDetails {
  /** Display-oriented diff of the changes made. */
  diff: string;
  /** Standard unified patch of the changes made. */
  patch: string;
  /** Line number of the first change in the new file (for editor navigation). */
  firstChangedLine?: number;
}

/**
 * Pluggable operations for the edit tool. Override to delegate file editing to remote systems
 * (e.g. SSH) while keeping the tool's matching + per-path serialization behavior.
 */
export interface EditOperations {
  /** Read bounded file contents as a Buffer. */
  readFile: (
    absolutePath: string,
    options: { maxBytes: number; signal?: AbortSignal },
  ) => Promise<Buffer>;
  /** Write content to a file. */
  writeFile: (absolutePath: string, content: string, options?: { signal?: AbortSignal }) => Promise<void>;
  /** Check the file is readable and writable (throw if not). */
  access: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<void>;
  /** Return target size before the bounded read. */
  statFile: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<{ size: number }>;
}

export interface EditToolOptions {
  /** Structured pre-execution policy checked before filesystem writes. */
  executionPolicy?: ExecutionPolicy;
  /** Custom operations backend (default: local filesystem). */
  operations?: EditOperations;
  /** Maximum target file bytes read for matching (default 8 MiB). */
  maxFileBytes?: number;
  /** Maximum aggregate UTF-8 bytes across old/new edit text (default 2 MiB). */
  maxInputBytes?: number;
  /** Maximum replacements per call (default 100). */
  maxEdits?: number;
}

const defaultEditOperations: EditOperations = {
  readFile: (path, options) => readFileBounded(path, options.maxBytes, options.signal),
  writeFile: (path, content, options) => fsWriteFile(path, content, { encoding: "utf-8", signal: options?.signal }),
  access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
  statFile: async (path) => ({ size: (await fsStat(path)).size }),
};

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: "edit",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

/** Port of pi's `prepareEditArguments`: tolerate model quirks (edits as JSON string; legacy fields). */
function prepareEditArguments(input: JsonObject): { path: string; edits: unknown } {
  let edits: unknown = input.edits;
  // Some models send edits as a JSON string instead of an array.
  if (typeof edits === "string") {
    try {
      const parsed = JSON.parse(edits) as unknown;
      if (Array.isArray(parsed)) edits = parsed;
    } catch {
      /* leave as-is; validation will reject */
    }
  }
  const path = typeof input.path === "string" ? input.path : "";
  // Legacy: top-level oldText/newText instead of edits[].
  if (typeof input.oldText === "string" && typeof input.newText === "string") {
    const arr = Array.isArray(edits) ? [...edits] : [];
    arr.push({ oldText: input.oldText, newText: input.newText });
    edits = arr;
  }
  return { path, edits };
}

function validateEdits(edits: unknown, maxEdits: number, maxInputBytes: number): Edit[] | string {
  if (!Array.isArray(edits) || edits.length === 0) {
    return "edits must contain at least one replacement.";
  }
  if (edits.length > maxEdits) return `edits contains ${edits.length} replacements, exceeds ${maxEdits} limit.`;
  const out: Edit[] = [];
  let inputBytes = 0;
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i] as { oldText?: unknown; newText?: unknown };
    if (typeof e?.oldText !== "string" || typeof e?.newText !== "string") {
      return `edits[${i}] must have string oldText and newText.`;
    }
    inputBytes += Buffer.byteLength(e.oldText, "utf-8") + Buffer.byteLength(e.newText, "utf-8");
    if (inputBytes > maxInputBytes) {
      return `edit input is ${inputBytes} bytes, exceeds ${maxInputBytes} byte limit.`;
    }
    out.push({ oldText: e.oldText, newText: e.newText });
  }
  return out;
}

export function createEditTool(cwd: string, options?: EditToolOptions): ToolDefinition {
  const ops = options?.operations ?? defaultEditOperations;
  const maxFileBytes = validateCodingLimit(
    "maxFileBytes",
    options?.maxFileBytes ?? DEFAULT_MAX_EDIT_FILE_BYTES,
    HARD_MAX_EDIT_FILE_BYTES,
  );
  const maxInputBytes = validateCodingLimit(
    "maxInputBytes",
    options?.maxInputBytes ?? DEFAULT_MAX_EDIT_INPUT_BYTES,
    HARD_MAX_EDIT_INPUT_BYTES,
  );
  const maxEdits = validateCodingLimit("maxEdits", options?.maxEdits ?? DEFAULT_MAX_EDITS, HARD_MAX_EDITS);

  return {
    name: "edit",
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit (relative or absolute)" },
        edits: {
          type: "array",
          description:
            "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
          items: {
            type: "object",
            properties: {
              oldText: {
                type: "string",
                description:
                  "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
              },
              newText: { type: "string", description: "Replacement text for this targeted edit." },
            },
            required: ["oldText", "newText"],
            additionalProperties: false,
          },
        },
      },
      required: ["path", "edits"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (typeof args.edits === "string" && Buffer.byteLength(args.edits, "utf-8") > maxInputBytes) {
        return errorResult(toolCallId, `edit input exceeds ${maxInputBytes} byte limit.`);
      }

      const prepared = prepareEditArguments(args);
      if (prepared.path.length === 0) {
        return errorResult(toolCallId, "path is required and must be a non-empty string.");
      }
      const editsOrError = validateEdits(prepared.edits, maxEdits, maxInputBytes);
      if (typeof editsOrError === "string") {
        return errorResult(toolCallId, editsOrError);
      }
      const edits = editsOrError;

      try {
        const absolutePath = resolveToCwd(prepared.path, cwd);

        const policyCheck = await enforceExecutionPolicy(
          options?.executionPolicy,
          {
            kind: "edit",
            operation: "edit",
            paths: [absolutePath],
            risk: "medium",
            metadata: { editCount: edits.length, sessionId: context.sessionId, runId: context.runId, signal: context.signal },
          },
          toolCallId,
          "edit",
        );
        if (!policyCheck.allowed) return policyCheck.result;
        const allowedPath = policyCheck.action.paths?.[0] ?? absolutePath;

        return await withFileMutationQueue(allowedPath, async () => {
          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

          // Check the file is readable + writable.
          try {
            await ops.access(allowedPath, { signal: context.signal });
          } catch (error) {
            if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");
            const err = error as NodeJS.ErrnoException;
            const errorMessage =
              error instanceof Error && "code" in error ? `Error code: ${err.code}` : String(error);
            return errorResult(toolCallId, `Could not edit file: ${prepared.path}. ${errorMessage}.`);
          }

          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

          const { size } = await ops.statFile(allowedPath, { signal: context.signal });
          if (size > maxFileBytes) {
            return errorResult(toolCallId, `Edit target is ${size} bytes, exceeds ${maxFileBytes} byte limit.`);
          }
          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");
          const buffer = await ops.readFile(allowedPath, { maxBytes: maxFileBytes, signal: context.signal });
          if (buffer.length > maxFileBytes) {
            return errorResult(toolCallId, `Edit target is ${buffer.length} bytes, exceeds ${maxFileBytes} byte limit.`);
          }
          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

          const rawContent = buffer.toString("utf-8");
          // The model will not include an invisible BOM in oldText.
          const { bom, text: content } = stripBom(rawContent);
          const originalEnding = detectLineEnding(content);
          const normalizedContent = normalizeToLF(content);

          // Apply exact-then-fuzzy matching. Throws on no-match / duplicate / overlap / empty / no-change.
          let baseContent: string;
          let newContent: string;
          try {
            ({ baseContent, newContent } = applyEditsToNormalizedContent(
              normalizedContent,
              edits,
              prepared.path,
            ));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return errorResult(toolCallId, message);
          }

          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

          const finalContent = bom + restoreLineEndings(newContent, originalEnding);
          await ops.writeFile(allowedPath, finalContent, { signal: context.signal });

          const diffResult = generateDiffString(baseContent, newContent);
          const patch = generateUnifiedPatch(prepared.path, baseContent, newContent);
          return {
            toolCallId,
            name: "edit",
            content: [
              { type: "text", text: `Successfully replaced ${edits.length} block(s) in ${prepared.path}.` },
            ],
            metadata: {
              diff: diffResult.diff,
              patch,
              firstChangedLine: diffResult.firstChangedLine,
            } satisfies EditToolDetails,
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(toolCallId, message);
      }
    },
  };
}
