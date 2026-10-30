import { opendir, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveRedactor, type SecretRedactor } from "@arnilo/prism";
import type { Memory, MemoryTagCount } from "@arnilo/prism-memory-core";
import { MemoryScopeError, MemoryValidationError, redactJson } from "@arnilo/prism-memory-core";
import { readFabricBlock } from "./blocks.js";
import type { FabricFileJail } from "./files.js";
import { MEMORY_FABRIC_WORKING_KEY, type MemoryNoteKind } from "./types.js";

/**
 * The memory directory: a small, write-versioned index of long-term memory (counts, top topics, recent
 * files, working-block labels) that sits in the prompt prefix so the agent knows what it could recall.
 * It is the first of three disclosure levels; `memory.view` pages the full lists, and `memory.recall` /
 * `memory.read` fetch content. It makes no model or embedding call.
 */
export interface MemoryFabricDirectoryConfig {
  /** Topics (tags/keywords) named in the prefix block. Default 8, at most {@link HARD_DIRECTORY_TOPICS}. */
  readonly maxTopics?: number;
  /** Recent files named in the prefix block. Default 10, at most {@link HARD_DIRECTORY_FILES}. */
  readonly maxFiles?: number;
  /** Ceiling on the rendered block. Default 200, at most {@link HARD_DIRECTORY_TOKENS}. */
  readonly maxTokens?: number;
}

export interface ResolvedFabricDirectoryOptions {
  readonly maxTopics: number;
  readonly maxFiles: number;
  readonly maxTokens: number;
}

export const DEFAULT_DIRECTORY_OPTIONS: ResolvedFabricDirectoryOptions = Object.freeze({ maxTopics: 8, maxFiles: 10, maxTokens: 200 });
export const HARD_DIRECTORY_TOPICS = 50;
export const HARD_DIRECTORY_FILES = 100;
export const HARD_DIRECTORY_TOKENS = 500;
/** Files one recompute walks, and tags it asks the store for; the paged `memory.view` lists stop here. */
const MAX_SCANNED_FILES = 1_000;
const MAX_WALK_DEPTH = 6;
const SNAPSHOT_TOPICS = 200;
const DIRECTORY_NOTE_KINDS: readonly MemoryNoteKind[] = ["fact", "preference", "procedure", "file"];

export function resolveFabricDirectoryOptions(
  input: boolean | MemoryFabricDirectoryConfig | undefined,
  defaultOn: boolean,
): false | ResolvedFabricDirectoryOptions {
  if (input === false || (input === undefined && !defaultOn)) return false;
  const config = input === true || input === undefined ? {} : input;
  const pick = (key: keyof ResolvedFabricDirectoryOptions, hard: number): number => {
    const value = config[key] ?? DEFAULT_DIRECTORY_OPTIONS[key];
    if (!Number.isInteger(value) || value < 1 || value > hard) {
      throw new MemoryValidationError(`directory.${key} must be an integer in [1,${hard}]`);
    }
    return value;
  };
  return {
    maxTopics: pick("maxTopics", HARD_DIRECTORY_TOPICS),
    maxFiles: pick("maxFiles", HARD_DIRECTORY_FILES),
    maxTokens: pick("maxTokens", HARD_DIRECTORY_TOKENS),
  };
}

const versions = new WeakMap<object, number>();

/** Record that a memory instance's notes, files, or blocks changed, so its directory is recomputed once. */
export function noteMemoryWrite(memory: object): void {
  versions.set(memory, (versions.get(memory) ?? 0) + 1);
}

/** The write counter behind {@link noteMemoryWrite}; the pinned core reuses it as its cache key. */
export function memoryWriteVersion(memory: object): number {
  return versions.get(memory) ?? 0;
}

const retractions = new WeakMap<object, number>();

/** End pinned session epochs when previously delivered memory may no longer be shown. */
export function noteMemoryRetraction(memory: object): void {
  retractions.set(memory, memoryRetractionVersion(memory) + 1);
  noteMemoryWrite(memory);
}

export function memoryRetractionVersion(memory: object): number {
  return retractions.get(memory) ?? 0;
}

export interface FabricDirectoryScopeSnapshot {
  readonly level: string;
  readonly counts: Readonly<Partial<Record<MemoryNoteKind, number>>>;
  readonly topics: readonly MemoryTagCount[];
}

export interface FabricDirectorySnapshot {
  /** Active notes by kind, summed over the active scopes. */
  readonly counts: Readonly<Partial<Record<MemoryNoteKind, number>>>;
  readonly topics: readonly MemoryTagCount[];
  /** Per-scope counts and topics, narrowest first; one entry per active scope with anything to say. */
  readonly scopes: readonly FabricDirectoryScopeSnapshot[];
  /** Relative paths under `tools.root`, most recently modified first. */
  readonly files: readonly string[];
  /** True when the file walk stopped at its scan cap. */
  readonly filesTruncated: boolean;
  readonly blocks: readonly string[];
}

export interface FabricDirectory {
  /** The cached snapshot; recomputed only after a write bumped the memory's version. */
  snapshot(signal?: AbortSignal): Promise<FabricDirectorySnapshot>;
  /** Force the next `snapshot` to recompute (file edits and reconciles that bypass the memory). */
  invalidate(): void;
}

/** A directory plus the caps its prefix block renders under; what the context hook and `memory.view` share. */
export interface FabricDirectoryHandle {
  readonly source: FabricDirectory;
  readonly options: ResolvedFabricDirectoryOptions;
}

export interface CreateFabricDirectoryOptions {
  /** The default (narrowest) memory; `memories` adds the other active scopes. */
  readonly memory: Memory;
  /** One memory per active scope; when omitted only `memory` is read. */
  readonly memories?: readonly { readonly level: string; readonly memory: Memory }[];
  /** Jail over `tools.root`; without it the directory names no files. */
  readonly files?: FabricFileJail;
  /** True for a relative path the walk must not list (the store's own SQLite file). */
  readonly exclude?: (relativePath: string) => boolean;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
}

async function walkFiles(jail: FabricFileJail, exclude: (path: string) => boolean, signal: AbortSignal | undefined) {
  const found: { path: string; mtimeMs: number }[] = [];
  let truncated = false;
  async function visit(relative: string, depth: number): Promise<void> {
    const directory = await opendir(await jail.resolve(relative === "" ? "." : relative));
    for await (const dirent of directory) {
      if (signal?.aborted) throw signal.reason ?? new Error("Directory scan aborted");
      if (dirent.name.startsWith(".")) continue;
      const path = relative === "" ? dirent.name : `${relative}/${dirent.name}`;
      if (dirent.isDirectory()) {
        if (depth < MAX_WALK_DEPTH) await visit(path, depth + 1);
      } else if (dirent.isFile() && !exclude(path)) {
        if (found.length >= MAX_SCANNED_FILES) {
          truncated = true;
          return;
        }
        found.push({ path, mtimeMs: (await stat(join(await jail.resolve(path)))).mtimeMs });
      }
    }
  }
  try {
    await visit("", 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files: found.map((file) => file.path), truncated };
}

export function createFabricDirectory(options: CreateFabricDirectoryOptions): FabricDirectory {
  const { memory } = options;
  const memories = options.memories ?? [{ level: "project", memory }];
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const redact = (text: string): string => redactJson(text, redactor);
  const exclude = options.exclude ?? (() => false);
  let forced = 0;
  let cached: { readonly key: string; readonly value: FabricDirectorySnapshot } | undefined;

  async function compute(signal: AbortSignal | undefined): Promise<FabricDirectorySnapshot> {
    const asOf = new Date().toISOString();
    const query = { asOf, ...(signal === undefined ? {} : { signal }) };
    // Aggregates are optional store capabilities; a store without them yields a directory with no counts.
    const optional = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await read();
      } catch (error) {
        if (error instanceof MemoryScopeError) return fallback;
        throw error;
      }
    };
    const [scopes, working, walked] = await Promise.all([
      Promise.all(
        memories.map(async ({ level, memory: scopeMemory }) => {
          const [counts, topics] = await Promise.all([
            optional(() => scopeMemory.countByKind(query), {} as Readonly<Record<string, number>>),
            optional(() => scopeMemory.topTags({ ...query, limit: SNAPSHOT_TOPICS }), [] as readonly MemoryTagCount[]),
          ]);
          return {
            level,
            counts: Object.fromEntries(DIRECTORY_NOTE_KINDS.flatMap((kind) => (counts[kind] ? [[kind, counts[kind]]] : []))),
            topics: topics.map((topic) => ({ tag: redact(topic.tag), count: topic.count })),
          } satisfies FabricDirectoryScopeSnapshot;
        }),
      ),
      memory.getWorking(signal === undefined ? {} : { signal }),
      options.files ? walkFiles(options.files, exclude, signal) : { files: [] as string[], truncated: false },
    ]);
    const counts: Record<string, number> = {};
    const topicsById = new Map<string, { tag: string; count: number }>();
    for (const scope of scopes) {
      for (const [kind, count] of Object.entries(scope.counts)) counts[kind] = (counts[kind] ?? 0) + (count ?? 0);
      for (const topic of scope.topics) {
        const existing = topicsById.get(topic.tag);
        if (existing) existing.count += topic.count;
        else topicsById.set(topic.tag, { tag: topic.tag, count: topic.count });
      }
    }
    const topics = [...topicsById.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    const blocksValue = (working?.value?.[MEMORY_FABRIC_WORKING_KEY] as { blocks?: Record<string, unknown> } | undefined)?.blocks;
    const blocks = Object.keys(blocksValue ?? {})
      .filter((label) => readFabricBlock(working, label) !== undefined)
      .sort();
    return {
      counts: Object.fromEntries(DIRECTORY_NOTE_KINDS.flatMap((kind) => (counts[kind] ? [[kind, counts[kind]]] : []))),
      topics,
      scopes,
      files: walked.files.map(redact),
      filesTruncated: walked.truncated,
      blocks: blocks.map(redact),
    };
  }

  return {
    async snapshot(signal) {
      const key = `${memories.reduce((sum, entry) => sum + (versions.get(entry.memory) ?? 0), 0)}:${forced}`;
      if (cached?.key === key) return cached.value;
      // Keyed by the version read before the query, so a write landing mid-compute is picked up next time.
      const value = await compute(signal);
      cached = { key, value };
      return value;
    },
    invalidate() {
      forced += 1;
    },
  };
}

const PLURAL: Record<string, string> = { fact: "facts", preference: "preferences", procedure: "procedures", file: "files" };

function countsSentence(counts: FabricDirectorySnapshot["counts"]): string | undefined {
  const parts = DIRECTORY_NOTE_KINDS.flatMap((kind) => {
    const count = counts[kind];
    return count ? [`${count} ${count === 1 ? kind : PLURAL[kind]}`] : [];
  });
  return parts.length === 0 ? undefined : parts.join(", ");
}

export function isFabricDirectoryEmpty(snapshot: FabricDirectorySnapshot): boolean {
  return countsSentence(snapshot.counts) === undefined && snapshot.files.length === 0 && snapshot.blocks.length === 0;
}

function renderLines(snapshot: FabricDirectorySnapshot, topics: number, files: number): string {
  const lines: string[] = [];
  if (snapshot.scopes.length > 1) {
    // One line per scope: counts and its own topics. Topic and file budgets are global.
    const perScope = Math.max(1, Math.floor(topics / snapshot.scopes.length));
    let remaining = topics;
    for (const scope of snapshot.scopes) {
      const counted = countsSentence(scope.counts);
      if (counted === undefined) continue;
      const take = Math.min(perScope, remaining);
      remaining -= take;
      const shown =
        take > 0 && scope.topics.length > 0
          ? `; topics: ${scope.topics
              .slice(0, take)
              .map((topic) => `${topic.tag} (${topic.count})`)
              .join(", ")}`
          : "";
      lines.push(`${scope.level}: ${counted}${shown}`);
    }
    if (lines.length > 0)
      lines[0] = `${lines[0]}. Recall with memory.recall${snapshot.files.length > 0 ? "; read files with memory.read" : ""}.`;
  } else {
    const counted = countsSentence(snapshot.counts);
    if (counted) lines.push(`${counted}. Recall with memory.recall${snapshot.files.length > 0 ? "; read files with memory.read" : ""}.`);
    if (topics > 0 && snapshot.topics.length > 0) {
      lines.push(
        `Topics: ${snapshot.topics
          .slice(0, topics)
          .map((topic) => `${topic.tag} (${topic.count})`)
          .join(", ")}`,
      );
    }
  }
  if (files > 0 && snapshot.files.length > 0) {
    const rest = snapshot.files.length - files;
    lines.push(
      `Files: ${snapshot.files.slice(0, files).join(", ")}${rest > 0 ? `, … (+${rest}${snapshot.filesTruncated ? "+" : ""})` : ""}`,
    );
  }
  if (snapshot.blocks.length > 0) lines.push(`Blocks: ${snapshot.blocks.join(", ")}`);
  return lines.join("\n");
}

/**
 * The prefix block text, deterministic for a snapshot (stable sort, no timestamps). The topic and file
 * lists shrink until the block fits `maxTokens`; only if the fixed lines alone exceed it is the text cut.
 */
export function renderFabricDirectory(
  snapshot: FabricDirectorySnapshot,
  options: ResolvedFabricDirectoryOptions,
): { readonly content: string; readonly tokens: number } | undefined {
  if (isFabricDirectoryEmpty(snapshot)) return undefined;
  let topics = Math.min(options.maxTopics, snapshot.topics.length);
  let files = Math.min(options.maxFiles, snapshot.files.length);
  let content = renderLines(snapshot, topics, files);
  while (Math.ceil(content.length / 4) > options.maxTokens && (topics > 0 || files > 0)) {
    if (files >= topics && files > 0) files -= 1;
    else topics -= 1;
    content = renderLines(snapshot, topics, files);
  }
  if (Math.ceil(content.length / 4) > options.maxTokens) content = content.slice(0, options.maxTokens * 4);
  return { content, tokens: Math.ceil(content.length / 4) };
}

export const DIRECTORY_VIEW_PAGE = 50;

/** One `memory.view` page: the full topic and file lists from `offset`, so deeper levels stay reachable. */
export function pageFabricDirectory(snapshot: FabricDirectorySnapshot, offset: number, size = DIRECTORY_VIEW_PAGE) {
  const topics = snapshot.topics.slice(offset, offset + size);
  const files = snapshot.files.slice(offset, offset + size);
  const more = offset + size < Math.max(snapshot.topics.length, snapshot.files.length);
  return {
    offset,
    topics,
    files,
    totals: { topics: snapshot.topics.length, files: snapshot.files.length, filesTruncated: snapshot.filesTruncated },
    ...(more ? { nextOffset: offset + size } : {}),
  };
}
