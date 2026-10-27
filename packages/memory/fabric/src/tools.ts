import { createHash } from "node:crypto";
import { relative } from "node:path";
import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import type { Memory, MemoryVectorRecord } from "@arnilo/prism-memory-core";
import { lexicalMatches, lexicalTerms, MemoryValidationError } from "@arnilo/prism-memory-core";
import { noteRelPath } from "@arnilo/prism-memory-core/fabric";
import { appendFabricBlock, assertFabricBlockLabel, fabricBlockId, readFabricBlock } from "./blocks.js";
import type { FabricCitationTracker } from "./context.js";
import { type FabricDirectoryHandle, pageFabricDirectory, renderFabricDirectory } from "./directory.js";
import { queryExcerpt } from "./excerpt.js";
import { createFabricFileJail, type FabricFileJail } from "./files.js";
import { parseRecallKinds } from "./recall.js";
import { selectWithScopeReserve } from "./scope/recall.js";
import { scanScopedMemoryContent } from "./scoped/trust.js";
import {
  estimateNoteTokens,
  type FabricScopeLevel,
  MEMORY_NOTE_KINDS,
  MEMORY_NOTE_METADATA_KEY,
  type MemoryFabric,
  type MemoryFabricForgetInput,
  type MemoryFabricToolsOptions,
  type MemoryNoteHit,
  type MemoryNoteKind,
  noteFields,
  parseMemoryNoteMetadata,
  stampProvenance,
  unreadableNoteReason,
} from "./types.js";

/** Everything the tools call back into; all of it comes from the fabric closure. */
export interface MemoryFabricToolDeps {
  readonly memory: Memory;
  readonly remember: MemoryFabric["remember"];
  readonly recall: MemoryFabric["recall"];
  readonly forget: MemoryFabric["forget"];
  /** When it answers `false`, indexed notes are unavailable and their tool branches fail closed. */
  readonly isIndexedNotesAvailable?: () => boolean;
  /** When present, `memory.view` without a path pages the long-term memory directory instead of listing the root. */
  readonly directory?: FabricDirectoryHandle;
  /** Candidate lifecycle: a confirming edit verifies, and `replace { id, pin }` exempts a note. */
  readonly lifecycle?: {
    readonly verify: (id: string, signal?: AbortSignal) => Promise<unknown>;
    readonly pin?: (id: string, pinned: boolean, signal?: AbortSignal) => Promise<unknown>;
  };
  /** Citation tracker: recalled notes join the tracker so citations in assistant output can be verified. */
  readonly tracker?: FabricCitationTracker;
  /** Locate the active scope memory that holds `id`; without it every note operation uses `memory`. */
  readonly noteMemory?: (id: string, signal?: AbortSignal) => Promise<Memory | undefined>;
  /**
   * Read notes by id across every active scope, through the same consent, invalidation and redaction
   * filters as recall; without it a read falls back to this fabric's single `memory`.
   */
  readonly readNotes?: (ids: readonly string[], signal?: AbortSignal) => Promise<readonly MemoryVectorRecord[]>;
  /** The session's touched files, used to arm a `path` note's prior. */
  readonly touchedPaths?: (sessionId: string) => readonly string[];
  /** The scope this tool set runs in; set only when the fabric is scoped. Widening writes `agent`. */
  readonly scopeLevel?: FabricScopeLevel;
}

/** Characters of a recalled note the tool shows; the densest matched window when the note is longer. */
const SNIPPET_CHARS = 600;
/** The tool default: every stored kind except `working`, which is already in the context prefix. */
const RECALL_TOOL_KINDS: readonly MemoryNoteKind[] = MEMORY_NOTE_KINDS.filter((kind) => kind !== "working");
/** One `memory.read` call reads at most this many notes by id. */
const MAX_READ_IDS = 8;

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

/** Provenance of an agent tool write; the session id is always present on a tool context. */
function agentStamp(context: ToolExecutionContext) {
  return stampProvenance("agent", new Date().toISOString(), { session: context.sessionId });
}

/**
 * Clear a note's trust flags after a clean agent rewrite (`memory.replace`) and stamp the writer.
 * `patchMetadata` preserves text, so this is the only step that lifts a quarantine.
 */
async function clearFlagsAndStamp(memory: Memory, id: string, context: ToolExecutionContext): Promise<void> {
  const generated = agentStamp(context);
  await memory.patchMetadata(
    id,
    (metadata) => {
      const fabric = metadata[MEMORY_NOTE_METADATA_KEY];
      if (fabric === null || typeof fabric !== "object" || Array.isArray(fabric)) return { ...metadata, generated };
      const { flags: _flags, ...rest } = fabric as Record<string, unknown>;
      return { ...metadata, generated, [MEMORY_NOTE_METADATA_KEY]: rest as JsonObject };
    },
    context.signal === undefined ? {} : { signal: context.signal },
  );
}

/** What a `memory.read` by id returns: the note's header fields and its full text. */
interface ReadNote {
  readonly id: string;
  readonly kind: MemoryNoteKind;
  readonly level?: MemoryNoteHit["level"];
  readonly status?: MemoryNoteHit["status"];
  readonly ingestedAt: string;
  readonly path: string;
  readonly tokenCount: number;
  readonly content: string;
}

/** A note's relative path: a file note names its file, every other note its file under the memory store. */
function notePathOf(note: {
  readonly id: string;
  readonly kind: MemoryNoteKind;
  readonly path?: string;
  readonly block?: string;
  readonly content: string;
  readonly status?: MemoryNoteHit["status"];
  readonly scope?: MemoryNoteHit["scope"];
}): string {
  if (note.kind === "working") return `working/${note.block ?? note.id}`;
  if (note.path !== undefined) return note.path;
  if (note.scope === undefined) return `entries/${note.id.slice(0, 8)}.md`;
  return noteRelPath({
    tenantId: note.scope.tenantId,
    resourceId: note.scope.resourceId,
    kind: note.kind,
    text: note.content,
    archived: note.status === "archived",
    id: note.id,
  });
}

/**
 * The fabric's tool set: `memory.view`, `memory.read`, `memory.insert`, `memory.recall`,
 * `memory.replace`, `memory.forget`. Each call builds fresh inert definitions — nothing is registered globally and
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
  const replaceName = "memory.replace";
  const recallName = "memory.recall";
  const forgetName = "memory.forget";

  return function tools(options: MemoryFabricToolsOptions = {}): readonly ToolDefinition[] {
    const jail: FabricFileJail | undefined =
      options.root === undefined
        ? undefined
        : createFabricFileJail(options.root, options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes });

    const indexedNotesAvailable = (): boolean => deps.isIndexedNotesAvailable?.() ?? true;
    const indexedNotesUnavailable = (name: string, context: ToolExecutionContext): ToolResult =>
      fail(name, context, "indexed_notes_unavailable", "Indexed notes are disabled for this fabric; only working blocks are supported.");

    type FileAccess = { readonly files: FabricFileJail } | { readonly denied: ToolResult };
    const gateFiles = (name: string, context: ToolExecutionContext): FileAccess => {
      if (!indexedNotesAvailable()) return { denied: indexedNotesUnavailable(name, context) };
      if (jail === undefined) {
        return { denied: fail(name, context, "no_root", "This fabric was created without a tools root, so file paths are unavailable.") };
      }
      return { files: jail };
    };

    return [
      {
        name: viewName,
        kind: "read",
        description:
          "Browse fabric memory. With no path, show the long-term memory directory (note counts, topics, recent files, working blocks) with the full topic and file lists, paged by offset. With a path, list that directory under the memory root.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory to list, relative to the memory root; omit for the memory directory." },
            offset: { type: "integer", minimum: 0, description: "Page offset into the directory's topic and file lists." },
          },
        } as JsonObject,
        async execute(args, context) {
          if (args.path === undefined && deps.directory) {
            const offset = args.offset === undefined ? 0 : args.offset;
            if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0)
              throw new MemoryValidationError("offset must be a non-negative integer");
            const snapshot = await deps.directory.source.snapshot(context.signal);
            const page = pageFabricDirectory(snapshot, offset);
            const summary = renderFabricDirectory(snapshot, deps.directory.options)?.content;
            const lines = [
              summary ?? "Long-term memory is empty.",
              ...(page.topics.length
                ? [
                    `Topics ${offset + 1}-${offset + page.topics.length} of ${page.totals.topics}: ${page.topics.map((topic) => `${topic.tag} (${topic.count})`).join(", ")}`,
                  ]
                : []),
              ...(page.files.length
                ? [
                    `Files ${offset + 1}-${offset + page.files.length} of ${page.totals.files}${page.totals.filesTruncated ? "+" : ""}: ${page.files.join(", ")}`,
                  ]
                : []),
              ...(page.nextOffset === undefined ? [] : [`More: call memory.view with offset ${page.nextOffset}.`]),
            ];
            return ok(
              viewName,
              context,
              { found: true, directory: { counts: snapshot.counts, blocks: snapshot.blocks }, ...page },
              lines.join("\n"),
            );
          }
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
          "Read one file inside the fabric memory directory, or notes by id. Pass exactly one of `path`, `id` or `ids` (1-8). Reading notes returns each one's full content with its id, kind, scope, date and path; an unknown or unreadable id is reported as not_found for that id alone. A file read is cut at the configured byte cap and flagged when truncated.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File to read, relative to the memory root." },
            id: { type: "string", description: "Note id to read in full." },
            ids: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: MAX_READ_IDS,
              description: "Note ids to read in full.",
            },
          },
        } as JsonObject,
        async execute(args, context) {
          if (args.ids !== undefined && !Array.isArray(args.ids)) throw new MemoryValidationError("ids must be an array of note ids");
          const targets: readonly unknown[] | undefined = Array.isArray(args.ids)
            ? args.ids
            : typeof args.id === "string"
              ? [args.id]
              : undefined;
          if (targets !== undefined) {
            if (typeof args.path === "string" || (typeof args.id === "string" && args.ids !== undefined))
              throw new MemoryValidationError("read accepts exactly one of path, id or ids");
            const wanted = [
              ...new Set(
                targets.map((id) => {
                  if (typeof id !== "string" || id.length === 0) throw new MemoryValidationError("each note id must be a non-empty string");
                  return id;
                }),
              ),
            ];
            if (wanted.length === 0) throw new MemoryValidationError("read requires at least one note id");
            if (wanted.length > MAX_READ_IDS) throw new MemoryValidationError(`read accepts at most ${MAX_READ_IDS} note ids`);
            if (!indexedNotesAvailable()) return indexedNotesUnavailable(readName, context);
            const readOptions = context.signal === undefined ? {} : { signal: context.signal };
            const records =
              deps.readNotes === undefined ? await deps.memory.get(wanted, readOptions) : await deps.readNotes(wanted, context.signal);
            const byId = new Map(records.map((record) => [record.id, record]));
            const notes: ReadNote[] = [];
            const missing: string[] = [];
            for (const id of wanted) {
              const record = byId.get(id);
              const metadata = record === undefined ? undefined : parseMemoryNoteMetadata(record.metadata);
              if (record === undefined || metadata === undefined) {
                missing.push(id);
                continue;
              }
              const fields = noteFields(metadata);
              const source = {
                id,
                kind: metadata.kind,
                content: record.text,
                ...(fields.path === undefined ? {} : { path: fields.path }),
                ...(fields.status === undefined ? {} : { status: fields.status }),
                scope: { tenantId: record.tenantId, resourceId: record.resourceId, threadId: record.threadId },
              };
              notes.push({
                id,
                kind: metadata.kind,
                ...(fields.level === undefined ? {} : { level: fields.level }),
                ...(fields.status === undefined ? {} : { status: fields.status }),
                ingestedAt: record.createdAt,
                content: record.text,
                tokenCount: estimateNoteTokens(record.text),
                path: notePathOf(source),
              });
            }
            const lines = notes.map(
              (note) =>
                `${note.id} ${note.level ?? "project"} [${note.kind}] date=${note.ingestedAt.slice(0, 10)} path=${note.path}\n${note.content}`,
            );
            for (const id of missing) lines.push(`${id} not_found`);
            return ok(readName, context, { found: notes.length > 0, notes, missing }, lines.join("\n\n"));
          }
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
          "Append to fabric memory. Pass `block` to append to a labeled working block, or `path` to append to a file under the memory root (which also refreshes that file's recallable note). Pass kind fact, preference, or procedure to write a typed durable note. Exactly one target is required. For durable notes, `keywords` should include synonyms and aliases: they are indexed with extra weight. Scope rule: user-wide preferences go to `user`; anything learned in this repository goes to `project`; only a lesson proven across projects goes to `agent`; use `path` with appliesTo for a note that holds for one subtree only; when unsure, choose the narrower scope.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to append or remember." },
            kind: { type: "string", enum: ["fact", "preference", "procedure"] },
            scope: {
              type: "string",
              enum: ["user", "agent", "project", "path"],
              description: "Where the note lives; defaults to user for preference and project otherwise.",
            },
            appliesTo: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 8,
              description: "Project-root-relative globs; required exactly when scope is path.",
            },
            key: { type: "string", description: "Stable subject id ([a-z0-9.-]{1,64}) for shadowing and widening." },
            supersedes: { type: "string" },
            tRef: { type: "string" },
            validFrom: { type: "string" },
            validTo: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            keywords: { type: "array", items: { type: "string" } },
            block: { type: "string", description: "Working block label to append to." },
            path: { type: "string", description: "File to append to, relative to the memory root." },
          },
          required: ["text"],
        } as JsonObject,
        async execute(args, context) {
          const text = typeof args.text === "string" ? args.text : "";
          const hasBlock = typeof args.block === "string";
          const hasPath = typeof args.path === "string";
          if ([args.block, args.path, args.kind].filter((value) => value !== undefined).length !== 1)
            throw new MemoryValidationError("insert requires exactly one of block, path or kind");
          if (args.kind !== undefined) {
            if (args.kind !== "fact" && args.kind !== "preference" && args.kind !== "procedure")
              throw new MemoryValidationError("kind must be fact, preference or procedure");
            // The team store is shared, reviewed memory: only `memory:share` writes it, with approval.
            if (args.scope === "team") {
              return fail(
                insertName,
                context,
                "team_read_only",
                "Team memory is read-only to tools: share a verified project note with memory:share instead.",
              );
            }
            if (args.scope === "agent" && deps.scopeLevel !== undefined && deps.scopeLevel !== "agent") {
              return fail(
                insertName,
                context,
                "agent_scope_requires_widening",
                "Agent scope is widening-only: write the lesson in this project and let maintenance promote it when another project verifies it.",
              );
            }
            if (!indexedNotesAvailable()) return indexedNotesUnavailable(insertName, context);
            const scan = scanScopedMemoryContent(text);
            if (!scan.ok) return fail(insertName, context, `refused: ${scan.class}`, `refused: ${scan.class}`);
            const note = await deps.remember(
              {
                kind: args.kind,
                content: text,
                ...Object.fromEntries(
                  ["supersedes", "tRef", "validFrom", "validTo", "tags", "keywords", "scope", "appliesTo", "key"]
                    .filter((key) => args[key] !== undefined)
                    .map((key) => [key, args[key]]),
                ),
              },
              { signal: context.signal, sessionId: context.sessionId },
            );
            return ok(insertName, context, { found: true, ...note }, `Remembered ${note.id} [${note.kind}].`);
          }
          if (!hasBlock && !hasPath) throw new MemoryValidationError("block or path must be a string");
          if (hasBlock) {
            const appended = await appendFabricBlock(deps.memory, args.block as string, text, {
              ...(context.signal === undefined ? {} : { signal: context.signal }),
              generated: agentStamp(context),
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
          const scan = scanScopedMemoryContent(text);
          if (!scan.ok) return fail(insertName, context, `refused: ${scan.class}`, `refused: ${scan.class}`);
          const written = await files.append(target, text);
          const file = await files.read(target);
          const indexed = file.text.slice(0, deps.memory.limits.maxEntryTextChars);
          await deps.remember(
            {
              kind: "file",
              path: relative(files.root, await files.resolve(target)),
              content: indexed,
              contentHash: createHash("sha256").update(file.text).digest("hex"),
            },
            { ...(context.signal === undefined ? {} : { signal: context.signal }), sessionId: context.sessionId },
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
        name: replaceName,
        kind: "edit",
        description:
          "Replace exactly one occurrence of old with new in one block, file path, or note id. Empty new deletes text. With a note id, `pin` also exempts the note from archiving and eviction.",
        parameters: {
          type: "object",
          properties: {
            old: { type: "string", minLength: 1 },
            new: { type: "string" },
            block: { type: "string" },
            path: { type: "string" },
            id: { type: "string" },
            pin: { type: "boolean", description: "Pin or unpin the note (note id only)." },
          },
          required: ["old", "new"],
        } as JsonObject,
        async execute(args, context) {
          if (typeof args.old !== "string" || !args.old.length || typeof args.new !== "string")
            throw new MemoryValidationError("old must be non-empty and new must be a string");
          if ([args.block, args.path, args.id].filter((value) => value !== undefined).length !== 1)
            throw new MemoryValidationError("replace requires exactly one of block, path or id");
          if (args.pin !== undefined && (typeof args.pin !== "boolean" || args.id === undefined))
            throw new MemoryValidationError("replace pin applies to a note id and must be a boolean");
          const options = { signal: context.signal };
          let content: string | undefined;
          let working: Awaited<ReturnType<Memory["getWorking"]>>;
          let files: FabricFileJail | undefined;
          let noteMemory: Memory | undefined;
          if (args.block !== undefined) {
            assertFabricBlockLabel(args.block);
            working = await deps.memory.getWorking(options);
            content = readFabricBlock(working, args.block)?.content;
          } else if (typeof args.path === "string") {
            const access = gateFiles(replaceName, context);
            if ("denied" in access) return access.denied;
            files = access.files;
            try {
              const file = await files.read(args.path);
              if (file.truncated) throw new MemoryValidationError("cannot replace in a truncated file");
              content = file.text;
            } catch (error) {
              if (!isNotFound(error)) throw error;
            }
          } else if (typeof args.id === "string") {
            if (!indexedNotesAvailable()) return indexedNotesUnavailable(replaceName, context);
            noteMemory = (await deps.noteMemory?.(args.id, context.signal)) ?? deps.memory;
            const entry = await noteMemory.getEntry(args.id, options);
            if (entry !== undefined && unreadableNoteReason(entry.metadata) !== undefined)
              return fail(
                replaceName,
                context,
                "unreadable",
                "This note was written by a newer version of memory and cannot be edited here.",
              );
            content = entry?.text;
          } else throw new MemoryValidationError("target must be a string");
          const index = content?.indexOf(args.old) ?? -1;
          if (index < 0 || content === undefined) return fail(replaceName, context, "not_found", "No matching text found.");
          if (content.indexOf(args.old, index + 1) >= 0) return fail(replaceName, context, "ambiguous", "More than one occurrence found.");
          const next = content.slice(0, index) + args.new + content.slice(index + args.old.length);
          if (typeof args.block === "string") {
            if (next.length > deps.memory.limits.maxEntryTextChars)
              throw new MemoryValidationError("block content exceeds the character cap");
            await deps.memory.updateWorking(
              {
                _fabric: {
                  blocks: {
                    [args.block]: { id: fabricBlockId(args.block), content: next, forgottenAt: null, generated: agentStamp(context) },
                  },
                },
              },
              { ...options, expectedVersion: working?.version },
            );
          } else if (files && typeof args.path === "string") {
            const scan = scanScopedMemoryContent(next);
            if (!scan.ok) return fail(replaceName, context, `refused: ${scan.class}`, `refused: ${scan.class}`);
            await files.write(args.path, next);
            const note = await deps.remember(
              {
                kind: "file",
                path: relative(files.root, await files.resolve(args.path)),
                content: next.trim().length === 0 ? args.path : next.slice(0, deps.memory.limits.maxEntryTextChars),
                contentHash: createHash("sha256").update(next).digest("hex"),
              },
              { ...options, sessionId: context.sessionId },
            );
            await clearFlagsAndStamp(deps.memory, note.id, context);
          } else {
            const scan = scanScopedMemoryContent(next);
            if (!scan.ok) return fail(replaceName, context, `refused: ${scan.class}`, `refused: ${scan.class}`);
            const target = noteMemory ?? deps.memory;
            await target.correct(args.id as string, next, options);
            await deps.lifecycle?.verify(args.id as string, context.signal);
            if (typeof args.pin === "boolean") await deps.lifecycle?.pin?.(args.id as string, args.pin, context.signal);
            await clearFlagsAndStamp(target, args.id as string, context);
          }
          return ok(replaceName, context, { found: true }, "Replaced one occurrence.");
        },
      },
      {
        name: recallName,
        kind: "search",
        description:
          "Recall fabric notes. Pass `query`, or `queries` with up to 4 phrasings (synonyms, aliases) fused into one ranked list. Returns ranked snippets with ids, scope, kind, dates, note paths, and the matched terms; each snippet is the densest matched window of its note. Defaults to every stored kind except working, and to 1,200 rendered tokens of output. Use memory.read with an id for a note in full.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to look for." },
            queries: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 4,
              description: "Up to 4 phrasings, fused by rank; use it to try synonyms in one call.",
            },
            kinds: {
              type: "array",
              items: { type: "string", enum: ["fact", "preference", "procedure", "file", "working", "episode", "exchange", "all"] },
              description: 'Kinds to search; defaults to every kind except working. `["all"]` searches every kind.',
            },
            topK: { type: "integer", description: "Maximum hits." },
            asOf: { type: "string", description: "ISO timestamp used for the validity window; defaults to now." },
            budget: { type: "integer", description: "Ceiling on the summed tokens of the rendered snippet lines; default 1200." },
            includeArchived: {
              type: "boolean",
              description: "Also search archived notes, appended after the active hits and marked [archived].",
            },
          },
        } as JsonObject,
        async execute(args, context) {
          if (!indexedNotesAvailable()) return indexedNotesUnavailable(recallName, context);
          const queries = readQueries(args);
          const kinds = readKinds(args.kinds) ?? RECALL_TOOL_KINDS;
          const options = {
            // Lexical mode returns weak coverage hits so the agent can judge them; hybrid keeps the cosine floor.
            minSimilarity: deps.memory.retrieval === "lexical" ? 0 : 0.35,
            kinds,
            ...(typeof args.topK === "number" ? { topK: args.topK } : {}),
            ...(typeof args.asOf === "string" ? { asOf: args.asOf } : {}),
            ...(args.includeArchived === true ? { includeArchived: true } : {}),
            ...(context.signal === undefined ? {} : { signal: context.signal }),
            ...(deps.touchedPaths === undefined ? {} : { touchedPaths: deps.touchedPaths(context.sessionId) }),
          };
          const results = await Promise.all(queries.map((query) => deps.recall(query, options)));
          // RRF over the per-query rankings, deduplicated by id; the first occurrence keeps the hit.
          const fused = new Map<string, { readonly hit: MemoryNoteHit; score: number }>();
          for (const result of results) {
            result.hits.forEach((hit, index) => {
              const contribution = 1 / (60 + index + 1);
              const existing = fused.get(hit.id);
              if (existing) existing.score += contribution;
              else fused.set(hit.id, { hit, score: contribution });
            });
          }
          const budget = typeof args.budget === "number" ? args.budget : 1200;
          const ranked = [...fused.values()].sort((a, b) => b.score - a.score).map(({ hit }) => hit);
          const queryTerms = new Set<string>();
          for (const query of queries) for (const term of lexicalTerms(query)) queryTerms.add(term);
          // Render before selecting: the budget counts what the model reads, header, path and snippet included.
          const rendered = new Map(
            ranked.map((hit) => {
              const matched = lexicalMatches(queryTerms, lexicalTerms(hit.content));
              const flagged = hit.flags?.length ? ` [flagged: ${hit.flags.join(", ")}]` : "";
              const lifecycle = hit.status === "candidate" ? " (candidate)" : hit.status === "archived" ? " [archived]" : "";
              const line = `${hit.id} ${hit.level ?? "project"} [${hit.kind}]${lifecycle}${flagged} path=${notePathOf(hit)} date=${hit.ingestedAt.slice(0, 10)} matched=[${matched.join(", ")}] ${queryExcerpt(hit.content, queryTerms, SNIPPET_CHARS)}`;
              return [hit.id, line] as const;
            }),
          );
          const hits = selectWithScopeReserve(ranked, {
            budget,
            tokens: (hit) => Math.max(1, Math.ceil((rendered.get(hit.id) ?? "").length / 4)),
            level: (hit) => hit.level ?? "project",
          });
          if (context.sessionId && hits.length > 0) {
            deps.tracker?.show(
              context.sessionId,
              hits.map((hit) => hit.id),
            );
          }
          const lines = hits.map((hit) => rendered.get(hit.id) ?? "");
          const top = hits.length === 0 ? 0 : Math.max(...hits.map((hit) => hit.coverage ?? hit.similarity ?? hit.score));
          if (lines.length === 0) lines.push("no match in any kind");
          else if (top < 0.34) lines.push("Weak match: try synonyms, an alias, or other terms.");
          if (hits.length > 0) lines.push("Cite [id] for notes you use.");
          return ok(recallName, context, { hits, explain: [] }, lines.join("\n"));
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
          const target: MemoryFabricForgetInput = {
            ...(typeof args.id === "string" ? { id: args.id } : {}),
            ...(typeof args.block === "string" ? { block: args.block } : {}),
            ...(args.hold === true ? { hold: true } : {}),
          };
          if (target.id !== undefined && !indexedNotesAvailable()) return indexedNotesUnavailable(forgetName, context);
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
  return parseRecallKinds(value);
}

/** `query`, `queries`, or both; 1-4 non-empty strings, deduplicated, first spelling wins. */
function readQueries(args: JsonObject): readonly string[] {
  const list = Array.isArray(args.queries) ? args.queries : args.queries === undefined ? [] : undefined;
  if (list === undefined) throw new MemoryValidationError("queries must be an array of strings");
  const raw = [...(typeof args.query === "string" ? [args.query] : []), ...list];
  if (raw.length === 0) throw new MemoryValidationError("query or queries is required");
  if (raw.length > 4) throw new MemoryValidationError("queries accepts at most 4 strings");
  const cleaned: string[] = [];
  for (const query of raw) {
    if (typeof query !== "string" || query.trim().length === 0) throw new MemoryValidationError("each query must be a non-empty string");
    if (!cleaned.includes(query.trim())) cleaned.push(query.trim());
  }
  return cleaned;
}
