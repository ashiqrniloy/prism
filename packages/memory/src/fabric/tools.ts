import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { MemoryValidationError } from "../errors.js";
import type { Memory } from "../types.js";
import { appendFabricBlock, assertFabricBlockLabel } from "./blocks.js";
import { createFabricFileJail, type FabricFileJail } from "./files.js";
import {
  isMemoryNoteKind,
  type MemoryFabric,
  type MemoryFabricForgetInput,
  type MemoryFabricToolsOptions,
  type MemoryNoteKind,
} from "./types.js";

/** Everything the tools call back into; all of it comes from the fabric closure. */
export interface MemoryFabricToolDeps {
  readonly memory: Memory;
  readonly remember: MemoryFabric["remember"];
  readonly recall: MemoryFabric["recall"];
  readonly forget: MemoryFabric["forget"];
  /** Session gate: tools only serve a session a host attached to this fabric. */
  readonly isAttached: (sessionId: string) => boolean;
}

const CONTENT_PREVIEW_CHARS = 400;

const ok = (name: string, context: ToolExecutionContext, value: unknown, text: string): ToolResult => ({
  toolCallId: context.toolCallId,
  name,
  value,
  content: [{ type: "text", text }],
});

const fail = (name: string, context: ToolExecutionContext, reason: string, text: string): ToolResult => ({
  toolCallId: context.toolCallId,
  name,
  value: { found: false, reason },
  content: [{ type: "text", text }],
  error: { message: text },
});

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * The fabric's tool set: `memory.view`, `memory.read`, `memory.insert`, `memory.recall`,
 * `memory.forget`. Each call builds fresh inert definitions — nothing is registered globally and
 * nothing executes until a host puts them on `AgentConfig.tools` and attaches a session.
 *
 * `memory.insert` appends to a labeled working block or to a file inside `root`; a file insert
 * also refreshes the `kind: "file"` note for that path so recall can find the content. `view` and
 * `read` never leave `root`, and every tool fails closed when the fabric has no attached session.
 */
export function createMemoryFabricTools(deps: MemoryFabricToolDeps): (options?: MemoryFabricToolsOptions) => readonly ToolDefinition[] {
  const viewName = "memory.view";
  const readName = "memory.read";
  const insertName = "memory.insert";
  const recallName = "memory.recall";
  const forgetName = "memory.forget";

  return function tools(options: MemoryFabricToolsOptions = {}): readonly ToolDefinition[] {
    const jail: FabricFileJail | undefined =
      options.root === undefined
        ? undefined
        : createFabricFileJail(options.root, options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes });

    const gate = (name: string, context: ToolExecutionContext): ToolResult | undefined =>
      deps.isAttached(context.sessionId)
        ? undefined
        : fail(name, context, "not_attached", "Fabric tools require a session attached to this fabric (fabric.attach(session)).");

    type FileAccess = { readonly files: FabricFileJail } | { readonly denied: ToolResult };
    const gateFiles = (name: string, context: ToolExecutionContext): FileAccess => {
      const denied = gate(name, context);
      if (denied) return { denied };
      if (jail === undefined) {
        return { denied: fail(name, context, "no_root", "This fabric was created without a tools root, so file paths are unavailable.") };
      }
      return { files: jail };
    };

    return [
      {
        name: viewName,
        kind: "read",
        description: "List the fabric memory directory: files and subdirectories under the configured root.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "Directory to list, relative to the memory root; defaults to the root." } },
        } as JsonObject,
        async execute(args, context) {
          const access = gateFiles(viewName, context);
          if ("denied" in access) return access.denied;
          const { files } = access;
          const requested = typeof args.path === "string" ? args.path : ".";
          try {
            const listing = await files.view(requested);
            const lines = listing.entries.map((entry) =>
              entry.kind === "directory" ? `${entry.name}/` : `${entry.name} (${entry.bytes ?? 0} bytes)`,
            );
            return ok(viewName, context, { found: true, ...listing }, lines.length === 0 ? `${listing.path} is empty.` : lines.join("\n"));
          } catch (error) {
            if (isNotFound(error)) return fail(viewName, context, "not_found", `No such directory under the memory root: ${requested}`);
            throw error;
          }
        },
      },
      {
        name: readName,
        kind: "read",
        description:
          "Read one file inside the fabric memory directory. Output is cut at the configured byte cap and flagged when truncated.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "File to read, relative to the memory root." } },
          required: ["path"],
        } as JsonObject,
        async execute(args, context) {
          const access = gateFiles(readName, context);
          if ("denied" in access) return access.denied;
          const { files } = access;
          if (typeof args.path !== "string") throw new MemoryValidationError("path is required");
          try {
            const content = await files.read(args.path);
            const notice = content.truncated ? `\n\n[truncated at ${files.maxFileBytes} bytes of ${content.bytes}]` : "";
            return ok(readName, context, { found: true, ...content }, `${content.text}${notice}`);
          } catch (error) {
            if (isNotFound(error)) return fail(readName, context, "not_found", `No such file under the memory root: ${args.path}`);
            throw error;
          }
        },
      },
      {
        name: insertName,
        kind: "edit",
        description:
          "Append to fabric memory. Pass `block` to append to a labeled working block, or `path` to append to a file under the memory root (which also refreshes that file's recallable note). Exactly one target is required.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to append." },
            block: { type: "string", description: "Working block label to append to." },
            path: { type: "string", description: "File to append to, relative to the memory root." },
          },
          required: ["text"],
        } as JsonObject,
        async execute(args, context) {
          const denied = gate(insertName, context);
          if (denied) return denied;
          const text = typeof args.text === "string" ? args.text : "";
          const hasBlock = typeof args.block === "string";
          const hasPath = typeof args.path === "string";
          if (hasBlock === hasPath) throw new MemoryValidationError("insert requires exactly one of block or path");
          if (hasBlock) {
            const appended = await appendFabricBlock(deps.memory, args.block as string, text, {
              ...(context.signal === undefined ? {} : { signal: context.signal }),
            });
            return ok(
              insertName,
              context,
              { found: true, block: appended.block, created: appended.created, chars: appended.content.length },
              `${appended.created ? "Created" : "Appended to"} block "${appended.block}" (${appended.content.length} chars).`,
            );
          }
          const access = gateFiles(insertName, context);
          if ("denied" in access) return access.denied;
          const { files } = access;
          const target = args.path as string;
          const written = await files.append(target, text);
          const file = await files.read(target);
          const indexed = file.text.slice(0, deps.memory.limits.maxEntryTextChars);
          await deps.remember(
            { kind: "file", path: target, content: indexed },
            { ...(context.signal === undefined ? {} : { signal: context.signal }) },
          );
          return ok(
            insertName,
            context,
            { found: true, path: written.path, bytes: written.bytes, noteTruncated: indexed.length < file.text.length },
            `Appended to ${written.path} (${written.bytes} bytes).`,
          );
        },
      },
      {
        name: recallName,
        kind: "search",
        description:
          "Recall fabric notes by query. Returns the matching notes with ids, kinds, scores, and why each one matched. Procedure notes are excluded unless kinds names them.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to look for." },
            kinds: {
              type: "array",
              items: { type: "string", enum: ["fact", "procedure", "file", "working", "episode"] },
              description: "Kinds to search; defaults to fact and file.",
            },
            topK: { type: "integer", description: "Maximum hits." },
            asOf: { type: "string", description: "ISO timestamp used for the validity window; defaults to now." },
            budget: { type: "integer", description: "Ceiling on the summed token count of the hits." },
          },
          required: ["query"],
        } as JsonObject,
        async execute(args, context) {
          const denied = gate(recallName, context);
          if (denied) return denied;
          if (typeof args.query !== "string" || args.query.trim().length === 0) throw new MemoryValidationError("query is required");
          const kinds = readKinds(args.kinds);
          const result = await deps.recall(args.query, {
            ...(kinds === undefined ? {} : { kinds }),
            ...(typeof args.topK === "number" ? { topK: args.topK } : {}),
            ...(typeof args.asOf === "string" ? { asOf: args.asOf } : {}),
            ...(typeof args.budget === "number" ? { budget: args.budget } : {}),
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          });
          const lines = result.hits.map((hit) => {
            const where = hit.path === undefined ? (hit.block === undefined ? "" : ` block=${hit.block}`) : ` path=${hit.path}`;
            return `${hit.id} [${hit.kind}]${where} score=${hit.score.toFixed(3)} ${hit.content.slice(0, CONTENT_PREVIEW_CHARS)}`;
          });
          return ok(recallName, context, result, lines.length === 0 ? "No notes matched." : lines.join("\n"));
        },
      },
      {
        name: forgetName,
        kind: "delete",
        description:
          "Tombstone one fabric note by id, or one working block by label. Pass hold to retain a note under legal hold instead of deleting it.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "12-character note id to forget." },
            block: { type: "string", description: "Working block label to forget." },
            hold: { type: "boolean", description: "Retain under legal hold instead of deleting." },
          },
        } as JsonObject,
        async execute(args, context) {
          const denied = gate(forgetName, context);
          if (denied) return denied;
          const target: MemoryFabricForgetInput = {
            ...(typeof args.id === "string" ? { id: args.id } : {}),
            ...(typeof args.block === "string" ? { block: args.block } : {}),
            ...(args.hold === true ? { hold: true } : {}),
          };
          if (target.block !== undefined) assertFabricBlockLabel(target.block);
          const result = await deps.forget(target, {
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          });
          const text =
            result.block === undefined
              ? result.held
                ? `Retained ${result.id} under legal hold; it is excluded from recall but not deleted.`
                : result.deleted > 0
                  ? `Forgot ${result.id} (${result.deleted} rows removed).`
                  : `No note ${result.id} in this scope; nothing was changed.`
              : result.deleted > 0
                ? `Forgot block "${result.block}".`
                : `No block "${result.block}" in this scope; nothing was changed.`;
          return ok(forgetName, context, { found: result.deleted > 0 || result.held, ...result }, text);
        },
      },
    ];
  };
}

function readKinds(value: unknown): readonly MemoryNoteKind[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new MemoryValidationError("kinds must be a non-empty array");
  for (const kind of value) if (!isMemoryNoteKind(kind)) throw new MemoryValidationError(`Unknown memory note kind: ${String(kind)}`);
  return value as readonly MemoryNoteKind[];
}
