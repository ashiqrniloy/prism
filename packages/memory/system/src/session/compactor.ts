/**
 * The `compaction` slot implementation. It summarizes from the session's ledger rather than from the raw transcript,
 * and delegates to the kernel default when this session has session memory off (or when the context carries no
 * session, which means the slot was not resolved to this package).
 *
 * A compaction removes only what STM has recorded (plan 218.3 Task 3): it picks the cut in tokens (`cut.ts`), has STM
 * cover every entry before it in the compaction's own call, then cuts no further than STM's coverage. A batch whose STM
 * model fails is recorded without the model (`fallbackObservations`, plan 218.3 Task 12), so the cut goes on; an abort
 * still throws, and a cut that would remove nothing declines ({@link NothingToCompactError}).
 *
 * One output larger than the window (plan 218.3 Task 5): a mid-loop compaction (the window-share vote or the kernel's
 * overflow recovery) whose kept tail holds one entry above the input cap declines ({@link OversizedEntryError}) before
 * any STM work: no mid-loop cut can make that request fit. The provider rejects it, the overflow compaction declines the
 * same way, and the kernel ends the run with `context_overflow` without a retry. The next run's between-loop compaction covers and removes that entry; `recall`
 * pages it.
 */
import type { CompactionContext, CompactionResult, Compactor, JsonValue, SessionContext, SessionEntry, SessionLog } from "@arnilo/prism";

import {
  type CompactionTriggerPoint,
  type ResolvedMemorySystemConfig,
  resolveKeepRecentTokens,
  resolveObservationsPoolTokens,
} from "./config.js";
import { entryIndexOf } from "./coverage-helpers.js";
import { activeWindowMessageIndexes, keptTailStart, pairStart } from "./cut.js";
import type { ObservationalFlushResult } from "./flush.js";
import { ledgerOf } from "./state.js";
import { createObservationalMemoryCompactor } from "./strategy.js";
import { estimateEntryTokens } from "./tokens.js";
import { SESSION_COMPACTED } from "./types.js";

export interface ObservationalCompactorOptions {
  readonly log: SessionLog<JsonValue>;
  readonly config: ResolvedMemorySystemConfig;
  /** The kernel default, used whenever this compactor must not act. */
  readonly fallback: Compactor;
  readonly isEnabled: (session: SessionContext) => boolean;
  /** Has STM cover the branch through `entryId` now (a cover-through flush). It throws when a batch fails. */
  readonly cover: (session: SessionContext, entryId: string, signal: AbortSignal | undefined) => Promise<ObservationalFlushResult>;
  /** Which trigger asked for this compaction: the last vote's point; an overflow or a manual compaction is mid-loop. */
  readonly pointFor: (session: SessionContext, trigger: CompactionContext["trigger"]) => CompactionTriggerPoint;
  readonly secrets?: readonly (string | undefined)[];
  /** Receives the secret set each compaction context carries, so background passes reuse it. */
  readonly onSecrets?: (session: SessionContext, secrets: readonly (string | undefined)[]) => void;
}

/** What the coverage pass of one compaction processed, kept on the compaction entry and the ledger (counts only). */
export interface CompactionCoverage {
  readonly entries: number;
  readonly tokens: number;
}

export function createObservationalCompactor(options: ObservationalCompactorOptions): Compactor {
  const kept = new WeakMap<CompactionContext, readonly string[]>();
  const memory = createObservationalMemoryCompactor({
    observationsPoolMaxTokens: (context) => resolveObservationsPoolTokens(context.inputCapTokens),
    advertiseRecall: options.config.recall,
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    ledgerOf: (context) => ledgerFor(options, context),
    keepEntryIds: (context) => kept.get(context) ?? [],
    ...(options.config.scope.text ? { scopeFallback: options.config.scope.text } : {}),
  });
  return {
    name: "session-memory",
    async compact(context: CompactionContext): Promise<CompactionResult> {
      const session = context.session;
      if (session && context.secrets?.length) options.onSecrets?.(session, context.secrets);
      if (!session || !options.isEnabled(session)) return options.fallback.compact(context);
      const entries = context.entries;
      const activeIndexes = activeWindowMessageIndexes(entries);
      const point = options.pointFor(session, context.trigger);
      if (point === "mid-loop" && context.inputCapTokens !== undefined) {
        const oversized = oversizedKeptEntryTokens(entries, activeIndexes, context.inputCapTokens);
        if (oversized !== undefined) throw new OversizedEntryError(oversized, context.inputCapTokens);
      }
      const wanted = keptTailStart(entries, {
        point,
        keepRecentTokens: resolveKeepRecentTokens(options.config.context, context.inputCapTokens),
        activeIndexes,
      });
      // Cover first: STM processes everything before the cut in this call (the kernel's own signal aborts it).
      const through = entries[wanted - 1]?.id;
      const covered = through === undefined ? undefined : (await options.cover(session, through, context.signal)).covered;
      // Then cut no further than coverage: an entry STM has not processed stays in the window.
      const coversUpToId = ledgerFor(options, context).latestObservationCoverageId;
      let coveredIndex = coversUpToId === undefined ? -1 : entryIndexOf(entries, coversUpToId);
      // A background pass in flight when the snapshot was taken may record coverage through a newer entry (plan 218.3
      // Task 12): that covers the whole snapshot, not none of it.
      if (coveredIndex < 0 && coversUpToId !== undefined && (await coversPastSnapshot(session, entries, coversUpToId)))
        coveredIndex = entries.length - 1;
      const start = coveredIndex + 1 < wanted ? pairStart(entries, activeIndexes, coveredIndex + 1) : wanted;
      // Nothing to remove (no active-window message before the cut): decline rather than add a compaction that only moves the prefix.
      if (!activeIndexes.some((index) => index < start))
        throw new NothingToCompactError(covered === undefined ? "the cut keeps the whole branch" : "STM covered no entry before the cut");
      kept.set(
        context,
        activeIndexes.filter((index) => index >= start).map((index) => entries[index]!.id),
      );
      const coverage: CompactionCoverage = { entries: covered?.entries ?? 0, tokens: covered?.tokens ?? 0 };
      const result = await memory.compact(context);
      await options.log.append(session, { type: SESSION_COMPACTED, coversUpToId: coversUpToId ?? null, point, coverage: { ...coverage } });
      return {
        ...result,
        ...(result.entries
          ? {
              entries: result.entries.map((entry) =>
                entry.kind === "compaction" ? { ...entry, data: { ...(entry.data as object), point, coverage: { ...coverage } } } : entry,
              ),
            }
          : {}),
      };
    },
  };
}

/**
 * A compaction declined because nothing would leave the window: the cut keeps every message, or STM covered none of
 * those before it. The kernel reports it on `compaction.completed` (`error`) and the run goes on; an overflow
 * compaction that declines ends the run with `context_overflow`.
 */
export class NothingToCompactError extends Error {
  readonly code = "nothing_to_compact";
  constructor(reason: string) {
    super(`session memory compaction removed nothing: ${reason}`);
    this.name = "NothingToCompactError";
  }
}

/**
 * A mid-loop compaction declined because one entry the mid-loop cut must keep (the newest tool round, or the newest
 * message) is larger than the input cap on its own: no compaction can make the retry fit. Counts only, never content.
 */
export class OversizedEntryError extends Error {
  readonly code = "oversized_entry";
  readonly entryTokens: number;
  readonly inputCapTokens: number;
  constructor(entryTokens: number, inputCapTokens: number) {
    super(
      `session memory declined a mid-loop compaction: one entry of ~${Math.round(entryTokens)} tokens exceeds the input cap of ${inputCapTokens}; the next run compacts it away`,
    );
    this.name = "OversizedEntryError";
    this.entryTokens = entryTokens;
    this.inputCapTokens = inputCapTokens;
  }
}

/** The estimate of the largest active-window message the mid-loop cut always keeps, when it alone exceeds `cap`. */
function oversizedKeptEntryTokens(entries: readonly SessionEntry[], activeIndexes: readonly number[], cap: number): number | undefined {
  let largest: number | undefined;
  const start = keptTailStart(entries, { point: "mid-loop", keepRecentTokens: 0, activeIndexes });
  for (const index of activeIndexes) {
    if (index < start) continue;
    const tokens = estimateEntryTokens(entries[index]!);
    if (tokens > cap && tokens > (largest ?? 0)) largest = tokens;
  }
  return largest;
}

/** Whether `coverageId` is a session entry newer than the snapshot's last entry. */
async function coversPastSnapshot(session: SessionContext, snapshot: readonly SessionEntry[], coverageId: string): Promise<boolean> {
  const last = snapshot.at(-1)?.id;
  if (last === undefined) return false;
  const current = await session.entries();
  const lastIndex = entryIndexOf(current, last);
  return lastIndex >= 0 && entryIndexOf(current, coverageId) > lastIndex;
}

function ledgerFor(options: Pick<ObservationalCompactorOptions, "log">, context: CompactionContext) {
  const session = context.session;
  if (!session) throw new TypeError("observational memory compaction needs the owning session context");
  return ledgerOf(options.log.entries(session));
}
