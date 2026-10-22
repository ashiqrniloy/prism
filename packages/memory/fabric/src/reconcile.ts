import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import type { Memory, VectorStore } from "@arnilo/prism-memory-core";
import { createFabricFileJail } from "./files.js";
import { scanScopedMemoryContent } from "./scoped/trust.js";
import { encodeMemoryNoteMetadata, MEMORY_NOTE_METADATA_KEY, parseMemoryNoteMetadata, stampProvenance } from "./types.js";

/** A SQLite file with its `-wal`/`-shm` siblings, in any of the excluded locations. */
function excludedSqlite(absolute: string, paths: string | readonly string[]): boolean {
  const list = typeof paths === "string" ? [paths] : paths;
  return list.some((path) => absolute === path || absolute.startsWith(`${path}-`));
}

/** One bounded startup pass; incomplete listings never imply that a file was deleted. */
export async function reconcileFabricFiles(options: {
  memory: Memory;
  vectorStore: VectorStore;
  root: string;
  maxFileBytes?: number;
  sqlitePath?: string | readonly string[];
  /** Relative path of the markdown store's own tree; never walked (its files are not `file` notes). */
  notesDir?: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { memory, vectorStore, signal } = options;
  const files = createFabricFileJail(options.root, { maxFileBytes: options.maxFileBytes });
  const scope = { ...memory.scope, threadId: memory.scope.threadId! };
  const budget = memory.limits.rebuildBatchSize;
  // shortcut: one index page per startup; use an explicit rebuild for indexes beyond the batch cap.
  const page = await vectorStore.listByThread!({ ...scope, limit: budget, signal });
  const invalidated = new Set(((await vectorStore.listInvalidated?.(scope, { signal })) ?? []).map((r) => r.id));
  const notes = new Map<string, { record: (typeof page.records)[number]; note: NonNullable<ReturnType<typeof parseMemoryNoteMetadata>> }>();
  for (const record of page.records) {
    const note = parseMemoryNoteMetadata(record.metadata);
    if (note?.kind === "file" && note.path) {
      const path = relative(files.root, await files.resolve(note.path));
      notes.set(path, { record, note });
    }
  }
  let visited = 0;
  const check = () => signal?.throwIfAborted();
  // Check deletion directly: a truncated directory listing is never evidence of deletion.
  for (const [path, { record }] of notes) {
    check();
    if (options.notesDir !== undefined && (path === options.notesDir || path.startsWith(`${options.notesDir}/`))) continue;
    if (invalidated.has(record.id)) continue;
    try {
      await files.resolve(path);
      await files.read(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await memory.forget({ ids: [record.id] }, { signal });
    }
  }
  async function walk(directory: string): Promise<void> {
    check();
    const listing = await files.view(directory);
    for (const entry of listing.entries) {
      check();
      if (++visited > budget) return;
      const path = join(directory, entry.name);
      const absolute = await files.resolve(path);
      const key = relative(files.root, absolute);
      if (options.notesDir !== undefined && (key === options.notesDir || key.startsWith(`${options.notesDir}/`))) continue;
      if (options.sqlitePath && excludedSqlite(absolute, options.sqlitePath)) continue;
      if (entry.kind === "directory") {
        await walk(path);
        continue;
      }
      const old = notes.get(key);
      if (old && invalidated.has(old.record.id)) continue;
      // A partial index page cannot establish that a note is new.
      if (!old && page.nextCursor) continue;
      const file = await files.read(path);
      if (file.truncated || !file.text.trim()) continue;
      const hash = createHash("sha256").update(file.text).digest("hex");
      if (old?.note.contentHash === hash) continue;
      const id = old?.record.id ?? createHash("sha256").update(`fabric:file:${key}`).digest("hex").slice(0, 12);
      // A file changed on disk is a human edit: scan it once, then quarantine it as a candidate
      // when the scan trips. A clean edit on a previously flagged note clears the flag.
      const scan = scanScopedMemoryContent(file.text);
      const wasFlagged = (old?.note.flags?.length ?? 0) > 0;
      const priorStatus = typeof old?.record.metadata?.status === "string" ? old.record.metadata.status : undefined;
      const status = scan.ok ? (wasFlagged ? undefined : priorStatus) : "candidate";
      const { flags: _priorFlags, ...priorNote } = old?.note ?? { v: 1 as const, kind: "file" as const };
      const { status: _priorStatus, generated: _priorGenerated, ...hostRest } = old?.record.metadata ?? {};
      await memory.remember(
        {
          entries: [
            {
              ...(old?.record ?? {}),
              id,
              text: file.text.slice(0, memory.limits.maxEntryTextChars),
              metadata: {
                ...hostRest,
                ...(status === undefined ? {} : { status }),
                generated: stampProvenance("human", new Date().toISOString()),
                [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({
                  ...priorNote,
                  kind: "file",
                  path: key,
                  contentHash: hash,
                  ...(scan.ok ? {} : { flags: [scan.class] }),
                }),
              },
            },
          ],
        },
        { wait: true, signal },
      );
    }
  }
  await walk(".");
}
