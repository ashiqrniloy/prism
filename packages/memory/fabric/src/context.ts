import {
  type ContentBlock,
  type ContextBlock,
  type ContextDraft,
  type HookContext,
  type Message,
  type SessionEntry,
  withContextBlocks,
} from "@arnilo/prism";
import {
  contentToText,
  HARD_TOP_K_CAP,
  latestUserText,
  lexicalTerms,
  type Memory,
  type MemoryContextProviderOptions,
  withTailContext,
} from "@arnilo/prism-memory-core";
import { foldObservationalMemoryLedger } from "@arnilo/prism-memory-observational";
import type { MemoryFabricInjectConfig } from "./config.js";
import { coreCandidateRows, type FabricCore } from "./delivery/core.js";
import type { FabricCueDuplicate, FabricCues } from "./delivery/cues.js";
import { type FabricDirectoryHandle, memoryRetractionVersion, renderFabricDirectory } from "./directory.js";
import { fitInjection } from "./excerpt.js";
import { isActiveNote } from "./lifecycle/index.js";
import type { MemoryFabric, MemoryFabricRecallOptions } from "./types.js";

/** Tracks notes shown to the model in each session and records citations in assistant text. */
export interface FabricCitationTracker {
  /** Record notes shown to the model in this session (via passive injection or recall tool). */
  show(sessionId: string, noteIds: readonly string[]): void;
  /** Scan assistant response text for bracketed ids `[<id>]`. */
  observe(sessionId: string, textChunk: string): void;
  /** Return all cited ids for the session (only ids previously shown count). */
  cited(sessionId: string): readonly string[];
  /** Take the retrieval counts accumulated since the previous call; diagnostics only, never a use. */
  takeRetrievals(sessionId: string): Readonly<Record<string, number>>;
  /** Clear tracking state for a session. */
  clear?(sessionId: string): void;
}

export function createFabricCitationTracker(): FabricCitationTracker {
  const sessions = new Map<
    string,
    { readonly shown: Set<string>; readonly cited: Set<string>; readonly retrievals: Map<string, number>; suffix: string }
  >();
  return {
    show(sessionId: string, noteIds: readonly string[]): void {
      let state = sessions.get(sessionId);
      if (!state) {
        state = { shown: new Set(), cited: new Set(), retrievals: new Map(), suffix: "" };
        sessions.set(sessionId, state);
      }
      for (const id of noteIds) {
        state.shown.add(id);
        state.retrievals.set(id, (state.retrievals.get(id) ?? 0) + 1);
      }
    },
    observe(sessionId: string, textChunk: string): void {
      const state = sessions.get(sessionId);
      if (!state) return;
      const text = state.suffix + textChunk;
      for (const match of text.matchAll(/\[([a-f0-9]{12})\]/g)) {
        const id = match[1]!;
        if (state.shown.has(id)) {
          state.cited.add(id);
        }
      }
      state.suffix = text.slice(-14);
    },
    cited(sessionId: string): readonly string[] {
      const state = sessions.get(sessionId);
      return state ? [...state.cited] : [];
    },
    takeRetrievals(sessionId: string): Readonly<Record<string, number>> {
      const state = sessions.get(sessionId);
      if (!state) return {};
      const counts = Object.fromEntries(state.retrievals);
      state.retrievals.clear();
      return counts;
    },
    clear(sessionId: string): void {
      sessions.delete(sessionId);
    },
  };
}

/**
 * Recalled and remembered text is attacker-reachable, so every fabric context block is wrapped as
 * untrusted and inert: instructions inside it are never treated as host instructions (MINJA).
 */
/** `Memory.get` rejects more ids than this per call. */
const MAX_REVALIDATE_IDS = 1000;

const UNTRUSTED_ENVELOPE = { untrusted: true, inert: true, injectionCapable: true } as const;

/** Resolve periods as UTC calendar intervals against the persisted message time. */
export function recallPeriod(text: string, timestamp: string): { text: string; options: MemoryFabricRecallOptions } {
  const reference = new Date(timestamp);
  let from: Date | undefined;
  let to: Date | undefined;
  let match = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (match) {
    from = new Date(`${match[0]}T00:00:00.000Z`);
    to = new Date(from.getTime() + 86_400_000);
  } else if ((match = text.match(/\blast week\b/i))) {
    from = new Date(reference);
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7) - 7);
    to = new Date(from.getTime() + 7 * 86_400_000);
  } else if (
    (match = text.match(
      /\b(?:in|last) (January|February|March|April|May|June|July|August|September|October|November|December)(?: (\d{4}))?\b/i,
    ))
  ) {
    const month = "january february march april may june july august september october november december"
      .split(" ")
      .indexOf(match[1]!.toLowerCase());
    const year = match[2] ? Number(match[2]) : reference.getUTCFullYear() - (month > reference.getUTCMonth() ? 1 : 0);
    from = new Date(Date.UTC(year, month, 1));
    to = new Date(Date.UTC(year, month + 1, 1));
  }
  if (!from || !to || !Number.isFinite(from.getTime())) return { text, options: {} };
  return {
    text: text.replace(match![0], "").trim(),
    options: { asOf: new Date(to.getTime() - 1), tRef: { from: from.toISOString(), to: to.toISOString() } },
  };
}

function planText(messages: readonly Message[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role === "tool" && Array.isArray(message.metadata?.todos)) return JSON.stringify(message.metadata.todos).slice(0, 2000);
    for (const block of [...message.content].reverse()) {
      if (block.type === "tool_result" && block.name === "todo_write" && !block.error && block.result !== undefined)
        return JSON.stringify(block.result).slice(0, 2000);
    }
  }
  return "";
}

function visibleMemory(draft: ContextDraft, entries: readonly SessionEntry[]) {
  const blocks = (draft.context ?? []).map((block) => block.metadata);
  for (const message of draft.messages) {
    const tail = message.metadata?.contextBlocks;
    if (Array.isArray(tail)) blocks.push(...tail);
  }
  const itemIds = new Set(blocks.flatMap((block) => (block?.source === "om" && Array.isArray(block.itemIds) ? block.itemIds : [])));
  const verbatim = new Set(draft.messages.map((message) => JSON.stringify([message.role, message.content])));
  const entryIds = new Set(
    entries
      .filter((entry) => entry.message && verbatim.has(JSON.stringify([entry.message.role, entry.message.content])))
      .map((entry) => entry.id),
  );
  const reads = new Set<string>();
  const readCalls = new Map(
    draft.messages.flatMap((message) =>
      message.content.flatMap((block) =>
        block.type === "tool_call" && block.name === "read" && typeof block.arguments.path === "string"
          ? [[block.id, block.arguments.path] as const]
          : [],
      ),
    ),
  );
  const readResults: string[] = [];
  for (const message of draft.messages)
    for (const block of message.content) {
      if (block.type !== "tool_result" || block.name !== "read" || block.error) continue;
      const path = readCalls.get(block.toolCallId);
      if (path) reads.add(path);
      readResults.push(JSON.stringify(block.result));
    }
  return (hit: FabricCueDuplicate): boolean =>
    itemIds.has(hit.id) ||
    (!!hit.sourceEntryIds?.length && hit.sourceEntryIds.every((id) => entryIds.has(id))) ||
    (hit.kind === "file" && !!hit.path && (reads.has(hit.path) || readResults.some((result) => result?.includes(hit.path!))));
}

/**
 * The directory block, or nothing when the fabric holds nothing or the aggregate query fails: the index
 * is a convenience, so a store without aggregates must never fail the turn. An abort still propagates.
 */
async function directoryBlock(directory: FabricDirectoryHandle, signal: AbortSignal | undefined): Promise<ContextBlock | undefined> {
  try {
    const rendered = renderFabricDirectory(await directory.source.snapshot(signal), directory.options);
    return rendered
      ? {
          title: "Long-term memory",
          content: rendered.content,
          metadata: { source: "fabric-directory", tokens: rendered.tokens, ...UNTRUSTED_ENVELOPE },
        }
      : undefined;
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
}

/**
 * The pinned core block and the ids it shows, or nothing when the fabric holds nothing: a store that
 * cannot scan or read never fails the turn. An abort still propagates.
 */
async function coreBlock(
  core: FabricCore,
  signal: AbortSignal | undefined,
): Promise<{ readonly block?: ContextBlock; readonly ids: readonly string[] }> {
  try {
    const rendered = await core.block(signal);
    if (rendered === undefined) return { ids: [] };
    return {
      ids: rendered.itemIds,
      block: {
        title: "Core memory",
        content: rendered.content,
        metadata: { source: "fabric-core", itemIds: rendered.itemIds, tokens: rendered.tokens, ...UNTRUSTED_ENVELOPE },
      },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ids: [] };
  }
}

/**
 * Whether every core note an epoch shows is still readable and still core-eligible in some active scope.
 * `false` means another process (or a file edit the reconcile picked up) retracted one; `undefined` means the
 * store could not answer. One bounded `get` per scope, so additive writes never reach this check. An abort
 * still propagates.
 */
async function coreStillShown(
  memories: readonly Memory[],
  ids: readonly string[],
  signal: AbortSignal | undefined,
): Promise<boolean | undefined> {
  try {
    const shown = new Set<string>();
    await Promise.all(
      memories.map(async (memory) => {
        for (let offset = 0; offset < ids.length; offset += MAX_REVALIDATE_IDS) {
          const records = await memory.get(ids.slice(offset, offset + MAX_REVALIDATE_IDS), signal === undefined ? {} : { signal });
          for (const row of coreCandidateRows(records.map((record) => ({ id: record.id, createdAt: "", metadata: record.metadata })))) {
            shown.add(row.id);
          }
        }
      }),
    );
    return ids.every((id) => shown.has(id));
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
}

/** One session's tail: the topic-injected lines for the current user turn, plus the cues added to it. */
interface SessionTail {
  readonly key: string;
  /** Header first when there are topic hits; empty otherwise. */
  readonly lines: readonly string[];
  readonly ids: readonly string[];
  readonly coverageById: Readonly<Record<string, number>>;
  /** Cue lines already added for this user turn, kept so a rebuild of the same turn is byte-identical. */
  readonly cueLines: string[];
  readonly cueIds: string[];
}

export function createFabricContext(
  memory: Memory,
  recall: MemoryFabric["recall"],
  inject: false | MemoryFabricInjectConfig = false,
  options: MemoryContextProviderOptions = {},
  directory?: FabricDirectoryHandle,
  tracker: FabricCitationTracker = createFabricCitationTracker(),
  touchedPaths?: (sessionId: string) => readonly string[],
  core?: FabricCore,
  cues?: FabricCues,
  memories: readonly Memory[] = [memory],
) {
  const cache = new Map<string, SessionTail>();
  const snapshots = new Map<string, { version: number; blocks: readonly ContextBlock[]; ids: readonly string[] }>();
  const invalidate = () => {
    directory?.source.invalidate();
    core?.invalidate();
    cues?.invalidate();
  };
  // Fabric tails follow all transcript messages, including the first user, so they cannot be hoisted into the prefix.
  const withTail = (draft: ContextDraft, blocks: readonly ContextBlock[]) => {
    if (blocks.length === 0) return draft;
    const rendered = withTailContext({ ...draft, messages: [] }, blocks).messages;
    return { ...draft, messages: [...draft.messages, ...rendered] };
  };
  return {
    refresh(sessionId?: string): void {
      if (sessionId === undefined) snapshots.clear();
      else snapshots.delete(sessionId);
      invalidate();
    },
    forget(sessionId: string): void {
      snapshots.delete(sessionId);
      cache.delete(sessionId);
    },
    async build(draft: ContextDraft, context: HookContext): Promise<ContextDraft> {
      const sessionId = context.session?.id ?? context.sessionId;
      const version = memories.reduce((sum, memory) => sum + memoryRetractionVersion(memory), 0);
      let pinned = snapshots.get(sessionId);
      let degraded = false;
      if (pinned !== undefined && pinned.version === version && pinned.ids.length > 0) {
        // Only what the frozen prefix displays is revalidated, so another process's additive writes keep it byte-stable.
        const shown = await coreStillShown(memories, pinned.ids, context.signal);
        if (shown === false) pinned = undefined;
        else degraded = shown === undefined;
      }
      if (pinned === undefined || pinned.version !== version) {
        // An epoch must see external writes even when this process's write counters did not change.
        invalidate();
        cache.delete(sessionId);
        const index = directory ? await directoryBlock(directory, context.signal) : undefined;
        const coreResult = core ? await coreBlock(core, context.signal) : { ids: [] };
        pinned = { version, blocks: [...(index ? [index] : []), ...(coreResult.block ? [coreResult.block] : [])], ids: coreResult.ids };
        snapshots.set(sessionId, pinned);
      }
      // A store that cannot confirm the core fails closed for this request: the snapshot stays, the block is not resent.
      const blocks = degraded ? pinned.blocks.filter((block) => block.metadata?.source !== "fabric-core") : pinned.blocks;
      const prefix = (blocks.length ? withContextBlocks(draft, blocks) : undefined) ?? draft;
      const working = options.includeWorking === false ? undefined : await memory.renderWorking();
      const tailBlocks: ContextBlock[] = [];
      if (working && Math.ceil(working.length / 4) <= memory.limits.maxInjectedTokens) {
        tailBlocks.push({ title: "Working memory", content: working, metadata: { source: "fabric-working", ...UNTRUSTED_ENVELOPE } });
      }
      // Path cues are a delivery tier on their own: they run whether or not topic injection is on.
      if (!inject && cues === undefined) return withTail(prefix, tailBlocks);
      const entries = (await context.session?.entries()) ?? [];
      const user = [...entries].reverse().find((entry) => entry.kind === "message" && entry.message?.role === "user");
      // No stable persisted turn identity means no passive recall and no per-turn cue budget.
      if (!user) return withTail(prefix, tailBlocks);
      let tail = cache.get(sessionId);
      if (tail === undefined || tail.key !== user.id) {
        let lines: string[] = [];
        let ids: string[] = [];
        let coverageById: Record<string, number> = {};
        if (inject) {
          const latest =
            (typeof options.query === "function" ? options.query({ messages: draft.messages }) : options.query) ??
            latestUserText(draft.messages) ??
            contentToText(user.message!.content);
          const period = recallPeriod(latest.slice(0, 2000), user.timestamp);
          const state = foldObservationalMemoryLedger(entries).taskState;
          const plan = planText(draft.messages) || planText(entries.flatMap((entry) => (entry.message ? [entry.message] : [])));
          const query =
            inject.query === "user"
              ? period.text
              : [period.text, state ? JSON.stringify(state).slice(0, 2000) : "", plan].filter(Boolean).join("\n");
          const result = query.trim()
            ? await recall(query, {
                ...period.options,
                kinds: inject.kinds,
                minSimilarity: inject.minSimilarity ?? 0.2,
                topK: HARD_TOP_K_CAP,
                // Injection never shows archived notes, so it never pays for the archive query either.
                archiveSearch: false,
                signal: context.signal,
                ...(touchedPaths === undefined ? {} : { touchedPaths: touchedPaths(sessionId) }),
              })
            : { hits: [] };
          const duplicate = visibleMemory(draft, entries);
          const asOfMs = period.options.asOf ? new Date(period.options.asOf).getTime() : Date.now();
          // A candidate, trust-flagged, or inactive/archived note is never injected passively; only tool recall sees it.
          const eligible = result.hits.filter((hit) => isActiveNote(hit, { asOfMs }) && (hit.flags?.length ?? 0) === 0 && !duplicate(hit));
          // Evidence-sized delivery: whole notes by rank up to the budget, and the best hit always
          // shown (as an excerpt when it alone exceeds the budget) so the budget cannot hide it.
          const { hits, lines: semanticLines } = fitInjection(
            eligible,
            lexicalTerms(query),
            inject.budgetTokens ?? 4000,
            inject.topK ?? 12,
            eligible.length,
          );
          if (hits.length > 0) {
            lines = semanticLines;
            ids = hits.map((hit) => hit.id);
            coverageById = Object.fromEntries(hits.filter((hit) => hit.coverage !== undefined).map((hit) => [hit.id, hit.coverage!]));
            tracker.show(sessionId, ids);
          }
        }
        tail = { key: user.id, lines, ids, coverageById, cueLines: [], cueIds: [] };
        cache.set(sessionId, tail);
      }
      // Path cues arrive after the topic block and join the same tail block; they show once per session.
      const cue =
        cues === undefined || touchedPaths === undefined
          ? undefined
          : await cues.render(context.session!, touchedPaths(sessionId), {
              turnKey: user.id,
              exclude: () => new Set([...pinned.ids, ...tail.ids, ...tail.cueIds]),
              duplicate: () => visibleMemory(draft, entries),
              signal: context.signal,
            });
      if (cue) {
        tail.cueLines.push(...cue.lines);
        tail.cueIds.push(...cue.itemIds);
        tracker.show(sessionId, cue.itemIds);
      }
      const lines = [...tail.lines, ...tail.cueLines];
      if (lines.length === 0) return withTail(prefix, tailBlocks);
      const content = lines.join("\n");
      return withTail(prefix, [
        ...tailBlocks,
        {
          title: "Semantic memory",
          content,
          metadata: {
            source: "fabric-semantic",
            itemIds: [...tail.ids, ...tail.cueIds],
            coverageById: tail.coverageById,
            tokens: Math.ceil(content.length / 4),
            ...UNTRUSTED_ENVELOPE,
          },
        },
      ]);
    },
    observe(content: ContentBlock, context: HookContext): void {
      if (!context.session || content.type !== "text") return;
      tracker.observe(context.session.id, content.text);
    },
    cited(context: HookContext): readonly string[] {
      return context.session ? tracker.cited(context.session.id) : [];
    },
    tracker,
  };
}
