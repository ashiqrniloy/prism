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
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { constants } from "node:fs";
import type {
  JsonObject,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import { resolveToCwd } from "./path-utils.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
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
  /** Read file contents as a Buffer. */
  readFile: (absolutePath: string) => Promise<Buffer>;
  /** Write content to a file. */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** Check the file is readable and writable (throw if not). */
  access: (absolutePath: string) => Promise<void>;
}

export interface EditToolOptions {
  /** Custom operations backend (default: local filesystem). */
  operations?: EditOperations;
}

const defaultEditOperations: EditOperations = {
  readFile: (path) => fsReadFile(path),
  writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
  access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
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

function validateEdits(edits: unknown): Edit[] | string {
  if (!Array.isArray(edits) || edits.length === 0) {
    return "edits must contain at least one replacement.";
  }
  const out: Edit[] = [];
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i] as { oldText?: unknown; newText?: unknown };
    if (typeof e?.oldText !== "string" || typeof e?.newText !== "string") {
      return `edits[${i}] must have string oldText and newText.`;
    }
    out.push({ oldText: e.oldText, newText: e.newText });
  }
  return out;
}

export function createEditTool(cwd: string, options?: EditToolOptions): ToolDefinition {
  const ops = options?.operations ?? defaultEditOperations;

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

      const prepared = prepareEditArguments(args);
      if (prepared.path.length === 0) {
        return errorResult(toolCallId, "path is required and must be a non-empty string.");
      }
      const editsOrError = validateEdits(prepared.edits);
      if (typeof editsOrError === "string") {
        return errorResult(toolCallId, editsOrError);
      }
      const edits = editsOrError;

      try {
        const absolutePath = resolveToCwd(prepared.path, cwd);

        return await withFileMutationQueue(absolutePath, async () => {
          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

          // Check the file is readable + writable.
          try {
            await ops.access(absolutePath);
          } catch (error) {
            if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");
            const err = error as NodeJS.ErrnoException;
            const errorMessage =
              error instanceof Error && "code" in error ? `Error code: ${err.code}` : String(error);
            return errorResult(toolCallId, `Could not edit file: ${prepared.path}. ${errorMessage}.`);
          }

          if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

          const buffer = await ops.readFile(absolutePath);
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
          await ops.writeFile(absolutePath, finalContent);

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
