/**
 * Delivery tier 2 (plan 188.5 Task 2): path cues.
 *
 * When a file tool touches a path, the path-scoped notes whose `applies_to` globs match it are shown
 * once in the session, in the tail, after the topic-injected block. The cue is the retrieval cue of
 * encoding specificity (Tulving & Thomson 1973): a note about `packages/memory/**` is worth its tokens
 * exactly when that directory is in play. Matching is a glob check over an index bucketed by each
 * glob's first literal segment, so one touched path checks one bucket, not every path note.
 *
 * It makes no model call: a metadata scan (cached until a note changes), then one bounded `get` for
 * the text of the notes that matched.
 */
import { resolveRedactor, type SecretRedactor, type SessionContext } from "@arnilo/prism";
import {
  type Memory,
  MemoryValidationError,
  type MemoryVectorMetadataPage,
  redactJson,
  type VectorScanMetadataQuery,
} from "@arnilo/prism-memory-core";
import { memoryWriteVersion } from "../directory.js";
import {
  DEFAULT_DECAY,
  isActiveNote,
  type MemoryNoteDecay,
  normalizeNoteStatus,
  retrievalStrength,
  type StorageWeights,
  storageStrength,
} from "../lifecycle/index.js";
import { globMatches } from "../scope/recall.js";
import { type MemoryNoteMetadata, parseMemoryNoteMetadata } from "../types.js";

export interface MemoryFabricCuesConfig {
  /** Ceiling on one turn's cue lines. Default 300, at most {@link HARD_CUE_TOKENS}. */
  readonly budgetTokens?: number;
  /** Notes a single turn may add by cue. Default 2, at most {@link HARD_CUES_PER_TURN}. */
  readonly maxPerTurn?: number;
}

export interface ResolvedFabricCuesOptions {
  readonly budgetTokens: number;
  readonly maxPerTurn: number;
}

export const HARD_CUE_TOKENS = 1_000;
export const HARD_CUES_PER_TURN = 5;
export const DEFAULT_CUES_OPTIONS: ResolvedFabricCuesOptions = Object.freeze({ budgetTokens: 300, maxPerTurn: 2 });

/** One metadata page per scan step, bounded: a project with more path notes than this scans no further. */
const CUE_SCAN_PAGE = 500;
const CUE_SCAN_MAX_PAGES = 8;
/** Injected ids are a session-state value (64 KiB cap); the oldest fall out first. */
const MAX_INJECTED_IDS = 1_024;
/** The bucket that holds every glob whose first segment is not literal (`**`, `*`, `?`). */
export const CUE_ANY_BUCKET = "*";

export function resolveFabricCuesOptions(
  input: boolean | MemoryFabricCuesConfig | undefined,
  defaultOn: boolean,
): false | ResolvedFabricCuesOptions {
  if (input === false || (input === undefined && !defaultOn)) return false;
  const config = input === true || input === undefined ? {} : input;
  const budgetTokens = config.budgetTokens ?? DEFAULT_CUES_OPTIONS.budgetTokens;
  if (!Number.isSafeInteger(budgetTokens) || budgetTokens < 1 || budgetTokens > HARD_CUE_TOKENS) {
    throw new MemoryValidationError(`cues.budgetTokens must be an integer in [1,${HARD_CUE_TOKENS}]`);
  }
  const maxPerTurn = config.maxPerTurn ?? DEFAULT_CUES_OPTIONS.maxPerTurn;
  if (!Number.isSafeInteger(maxPerTurn) || maxPerTurn < 1 || maxPerTurn > HARD_CUES_PER_TURN) {
    throw new MemoryValidationError(`cues.maxPerTurn must be an integer in [1,${HARD_CUES_PER_TURN}]`);
  }
  return { budgetTokens, maxPerTurn };
}

/** The session-state record this tier owns: the notes it has already shown. */
export interface FabricCueSessionState {
  get(session: SessionContext): unknown;
  set(session: SessionContext, value: { readonly injected: readonly string[] }): Promise<void>;
}

/** The minimum a note exposes for cross-source dedup, satisfied by a recall hit and by a cue. */
export interface FabricCueDuplicate {
  readonly id: string;
  readonly kind: string;
  readonly path?: string;
  readonly sourceEntryIds?: readonly string[];
}

export interface FabricCueBlock {
  /** One `- [id] path <kind> (for <glob>) <text>` line per note. */
  readonly lines: readonly string[];
  readonly tokens: number;
  readonly itemIds: readonly string[];
}

export interface FabricCueRenderOptions {
  /** The persisted user turn, so `maxPerTurn` counts per turn rather than per build. */
  readonly turnKey?: string;
  /** Ids already visible this turn (core and topic injection); resolved lazily. */
  readonly exclude?: () => ReadonlySet<string>;
  /** The existing visible-read dedup, resolved only when a note actually matched. */
  readonly duplicate?: () => ((note: FabricCueDuplicate) => boolean) | undefined;
  readonly signal?: AbortSignal;
}

export interface FabricCues {
  /** Cue lines for paths this session has not considered yet, or nothing when none is new. */
  render(session: SessionContext, paths: readonly string[], options?: FabricCueRenderOptions): Promise<FabricCueBlock | undefined>;
  /** Force the next render to rebuild its index (writes that bypass the memory instance). */
  invalidate(): void;
  /** Drop the in-memory path bookkeeping of a closed session. */
  forget(sessionId: string): void;
}

export interface CreateFabricCuesOptions {
  /** The project scope: path notes live there and only there. */
  readonly memory: Memory;
  readonly options: ResolvedFabricCuesOptions;
  readonly scanMetadata: (query: VectorScanMetadataQuery) => Promise<MemoryVectorMetadataPage>;
  readonly state: FabricCueSessionState;
  readonly storageWeights?: StorageWeights;
  readonly decay?: MemoryNoteDecay;
  readonly clock?: () => number;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
}

/** The index bucket of a glob: its first segment when literal, else {@link CUE_ANY_BUCKET}. */
export function cueBucket(glob: string): string {
  const first = glob.split("/")[0] ?? "";
  return first.length > 0 && !first.includes("*") && !first.includes("?") ? first : CUE_ANY_BUCKET;
}

interface CueEntry {
  readonly id: string;
  readonly metadata: MemoryNoteMetadata;
  readonly globs: readonly string[];
  readonly status: "verified" | "candidate";
  readonly storage: number;
  readonly retrieval: number;
}

interface CueMatch {
  readonly entry: CueEntry;
  readonly glob: string;
}

interface SessionCues {
  readonly considered: Set<string>;
  turnKey: string | undefined;
  count: number;
}

/** Workspace-relative only, as the touched-path tracker already guarantees; this is belt and braces. */
function usablePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    !path.startsWith("/") &&
    !/^[a-zA-Z]:/.test(path) &&
    !path.includes("\0") &&
    !path.includes("\\") &&
    !path.split("/").includes("..")
  );
}

function readInjected(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object") return [];
  const injected = (value as { injected?: unknown }).injected;
  return Array.isArray(injected) ? injected.filter((id): id is string => typeof id === "string") : [];
}

export function createFabricCues(input: CreateFabricCuesOptions): FabricCues {
  const redactor = resolveRedactor(input.redactor, input.secrets);
  const redact = (text: string): string => redactJson(text, redactor).replace(/\s+/g, " ").trim();
  const { budgetTokens, maxPerTurn } = input.options;
  const sessions = new Map<string, SessionCues>();
  let forced = 0;
  let cached: { readonly key: string; readonly index: ReadonlyMap<string, readonly CueEntry[]> } | undefined;

  async function buildIndex(signal: AbortSignal | undefined): Promise<ReadonlyMap<string, readonly CueEntry[]>> {
    const index = new Map<string, CueEntry[]>();
    const clock = input.clock?.() ?? 0;
    let cursor: string | undefined;
    for (let pages = 0; pages < CUE_SCAN_MAX_PAGES; pages += 1) {
      const page: MemoryVectorMetadataPage = await input.scanMetadata({
        scope: { tenantId: input.memory.scope.tenantId, resourceId: input.memory.scope.resourceId },
        limit: CUE_SCAN_PAGE,
        ...(cursor === undefined ? {} : { cursor }),
        ...(signal === undefined ? {} : { signal }),
      });
      for (const row of page.rows) {
        if (row.metadata === null || typeof row.metadata !== "object") continue;
        const metadata = parseMemoryNoteMetadata(row.metadata);
        if (metadata === undefined || metadata.scope !== "path" || (metadata.appliesTo?.length ?? 0) === 0) continue;
        if ((metadata.flags?.length ?? 0) > 0) continue;
        // Passive delivery shows a candidate only when no verified note covers the path; archived never.
        const status = normalizeNoteStatus(row.metadata.status as string | undefined, "verified");
        if (status !== "verified" && status !== "candidate") continue;
        if (!isActiveNote(metadata, status === "candidate" ? { allowCandidate: true } : {})) continue;
        const entry: CueEntry = {
          id: row.id,
          metadata,
          globs: metadata.appliesTo!,
          status,
          storage: storageStrength(metadata, input.storageWeights),
          retrieval: retrievalStrength(metadata, clock, input.decay?.[metadata.kind] ?? DEFAULT_DECAY.fact),
        };
        for (const glob of entry.globs) {
          const bucket = cueBucket(glob);
          const list = index.get(bucket);
          if (list === undefined) index.set(bucket, [entry]);
          else list.push(entry);
        }
      }
      cursor = page.nextCursor;
      if (cursor === undefined) break;
    }
    return index;
  }

  async function indexFor(signal: AbortSignal | undefined): Promise<ReadonlyMap<string, readonly CueEntry[]>> {
    const key = `${memoryWriteVersion(input.memory)}:${forced}`;
    if (cached?.key === key) return cached.index;
    const index = await buildIndex(signal);
    cached = { key, index };
    return index;
  }

  function sessionCues(sessionId: string): SessionCues {
    let state = sessions.get(sessionId);
    if (state === undefined) {
      state = { considered: new Set(), turnKey: undefined, count: 0 };
      sessions.set(sessionId, state);
    }
    return state;
  }

  return {
    async render(session, paths, options = {}) {
      const state = sessionCues(session.id);
      const fresh = paths.filter((path) => usablePath(path) && !state.considered.has(path));
      if (fresh.length === 0) return undefined;
      // Considered marks a path as handled even if nothing matched, so a repeat build does no query.
      for (const path of fresh) state.considered.add(path);
      if (options.turnKey !== undefined && options.turnKey !== state.turnKey) {
        state.turnKey = options.turnKey;
        state.count = 0;
      }
      const remaining = maxPerTurn - state.count;
      if (remaining <= 0) return undefined;
      const injected = new Set(readInjected(input.state.get(session)));
      const excluded = options.exclude?.();
      const index = await indexFor(options.signal);
      const matches = new Map<string, CueMatch>();
      for (const path of fresh) {
        const first = path.split("/")[0] ?? "";
        const bucket = [...(index.get(first) ?? []), ...(index.get(CUE_ANY_BUCKET) ?? [])];
        const hit = bucket.flatMap((entry) => {
          const glob = entry.globs.find((candidate) => globMatches(candidate, path));
          return glob === undefined ? [] : [{ entry, glob }];
        });
        const verified = hit.filter((match) => match.entry.status === "verified");
        for (const match of verified.length > 0 ? verified : hit) {
          if (matches.has(match.entry.id) || injected.has(match.entry.id) || excluded?.has(match.entry.id) === true) continue;
          matches.set(match.entry.id, match);
        }
      }
      if (matches.size === 0) return undefined;
      const ordered = [...matches.values()].sort(
        (left, right) =>
          right.entry.storage - left.entry.storage ||
          right.entry.retrieval - left.entry.retrieval ||
          (left.entry.id < right.entry.id ? -1 : left.entry.id > right.entry.id ? 1 : 0),
      );
      // One batched read; a revoked, invalidated, or unreadable note has no text and never shows.
      const records = await input.memory.get(
        ordered.map((match) => match.entry.id),
        options.signal === undefined ? {} : { signal: options.signal },
      );
      const text = new Map(records.map((record) => [record.id, record.text]));
      const duplicate = options.duplicate?.();
      const lines: string[] = [];
      const itemIds: string[] = [];
      let tokens = 0;
      for (const match of ordered) {
        if (itemIds.length >= remaining) break;
        const body = text.get(match.entry.id);
        if (body === undefined) continue;
        const metadata = match.entry.metadata;
        if (
          duplicate?.({
            id: match.entry.id,
            kind: metadata.kind,
            ...(metadata.path === undefined ? {} : { path: metadata.path }),
            ...(metadata.sourceEntryIds === undefined ? {} : { sourceEntryIds: metadata.sourceEntryIds }),
          }) === true
        ) {
          continue;
        }
        const line = `- [${match.entry.id}] path ${metadata.kind} (for ${match.glob})${match.entry.status === "candidate" ? " (candidate)" : ""} ${redact(body)}`;
        const cost = Math.ceil((line.length + 1) / 4);
        if (tokens + cost > budgetTokens) continue;
        lines.push(line);
        tokens += cost;
        itemIds.push(match.entry.id);
      }
      if (itemIds.length === 0) return undefined;
      state.count += itemIds.length;
      await input.state.set(session, { injected: [...injected, ...itemIds].slice(-MAX_INJECTED_IDS) });
      return { lines, tokens, itemIds };
    },
    invalidate() {
      forced += 1;
    },
    forget(sessionId) {
      sessions.delete(sessionId);
    },
  };
}
