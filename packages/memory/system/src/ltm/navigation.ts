import type { Memory, MemoryVectorMetadataRow, VectorStore } from "@arnilo/prism-memory-core";
import { parseMemoryNoteMetadata } from "./types.js";

/** One `memory.read` navigation request: an exchange's same-session neighbours, or one session page. */
export interface NoteNavigationRequest {
  readonly around?: string;
  readonly session?: string;
  readonly page?: number;
}

/**
 * Session navigation for `memory.read { around | session }` (plan 202 Task 5). Shared by
 * `createLongTermMemory().tools()` and the package's tool set, so both resolve the same exchanges
 * (plan 210 Task 2: the package's tools had been built without it, so navigation never fired there).
 */
export function createNoteNavigator(deps: {
  readonly memories: readonly Memory[];
  readonly vectorStore?: VectorStore;
  readonly notify?: (message: string) => void;
}): (request: NoteNavigationRequest, signal?: AbortSignal) => Promise<readonly string[]> {
  async function memoryWithNote(id: string, signal?: AbortSignal): Promise<Memory | undefined> {
    for (const candidate of deps.memories) {
      if ((await candidate.getEntry(id, signal === undefined ? {} : { signal })) !== undefined) return candidate;
    }
    return undefined;
  }
  return async function navigateNotes(request, signal) {
    let session = request.session;
    let memories = deps.memories;
    if (request.around !== undefined) {
      const owner = await memoryWithNote(request.around, signal);
      if (owner === undefined) return [];
      const anchor = await owner.getEntry(request.around, { signal });
      const metadata = anchor === undefined ? undefined : parseMemoryNoteMetadata(anchor.metadata);
      if (metadata?.kind !== "exchange" || !metadata.session) return [];
      session = metadata.session;
      memories = [owner];
    }
    if (!session) return [];
    const rows = new Map<string, { id: string; time: string }>();
    for (const source of memories) {
      const { tenantId, resourceId, threadId } = source.scope;
      if (!tenantId || !resourceId || !threadId) continue;
      const store = deps.vectorStore;
      let metadataRows: readonly MemoryVectorMetadataRow[] = [];
      if (store?.listBySession) {
        metadataRows = await store.listBySession({ tenantId, resourceId, threadId }, session, { signal });
      } else if (store?.scanMetadata) {
        deps.notify?.("memory-fabric: store has no listBySession; session navigation uses a metadata scan");
        const collected: MemoryVectorMetadataRow[] = [];
        let cursor: string | undefined;
        do {
          signal?.throwIfAborted();
          const page = await store.scanMetadata({ scope: { tenantId, resourceId }, limit: 200, cursor, signal });
          collected.push(...page.rows);
          cursor = page.nextCursor;
        } while (cursor !== undefined);
        // get() below binds every candidate back to the exact active thread.
        metadataRows = collected;
      } else {
        deps.notify?.("memory-fabric: session navigation unavailable; store has no listBySession or scanMetadata");
      }
      const candidates = metadataRows.filter((row) => {
        const metadata = parseMemoryNoteMetadata(row.metadata);
        return metadata?.kind === "exchange" && metadata.session === session;
      });
      // Bind metadata to the active memory before paging, excluding revoked and foreign-thread rows.
      for (let start = 0; start < candidates.length; start += 200) {
        const batch = candidates.slice(start, start + 200);
        const readable = store?.listBySession
          ? batch
          : await source.get(
              batch.map((row) => row.id),
              { signal },
            );
        for (const record of readable) {
          const metadata = parseMemoryNoteMetadata(record.metadata);
          const now = Date.now();
          if (
            metadata?.kind !== "exchange" ||
            metadata.session !== session ||
            metadata.status === "archived" ||
            metadata.status === "retired" ||
            metadata.status === "candidate" ||
            (metadata.validFrom !== undefined && Date.parse(metadata.validFrom) > now) ||
            (metadata.validTo !== undefined && Date.parse(metadata.validTo) <= now)
          )
            continue;
          if (!rows.has(record.id)) rows.set(record.id, { id: record.id, time: metadata.tRef ?? record.createdAt });
        }
      }
    }
    const sorted = [...rows.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.id.localeCompare(b.id));
    if (request.around !== undefined) {
      const index = sorted.findIndex((row) => row.id === request.around);
      return index < 0 ? [] : sorted.slice(Math.max(0, index - 2), index + 3).map((row) => row.id);
    }
    const offset = (request.page ?? 0) * 8;
    return sorted.slice(offset, offset + 8).map((row) => row.id);
  };
}
