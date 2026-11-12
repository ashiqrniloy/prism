/**
 * Working memory (plan 218 Task 2, design §5.4): verdicts on named STM records, incremental only (I6).
 *
 * Each STM record the pass is sent gets at most one verdict: `keep` (it becomes a WM `event`), `summarize` (several
 * records become one WM `summary`), or `discard` (finished, out of scope, superseded or a duplicate). `derive` records an
 * episode-scoped WM `fact` several records or items support; it gives no verdict. A record left without a verdict stays
 * on the STM surface for the next pass. `summarize` and `derive` supersede only the WM items they name; nothing
 * replaces the WM set. The worker records nothing itself: the flush appends its items and tombstones.
 */
import type { JsonObject, ModelClient, ProviderRequestOptions, ToolDefinition, ToolResult } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";
import {
  joinWorkerText,
  type MemoryWorkerLimitOptions,
  resolveMemoryWorkerLimits,
  runMemoryWorkerLoop,
} from "@arnilo/prism-memory-system/core";
import { attributionLabel, attributionOfSources, isAssistantProposal } from "../attribution.js";
import { createMemoryId } from "../ids.js";
import { activeObservations, activeWmItems, type ObservationalMemoryLedger } from "../ledger.js";
import { normalizeEventText } from "../normalize.js";
import { type ProtectionReason, protectedTokenCount } from "../protections.js";
import type { SalienceSignal } from "../salience.js";
import { type EpisodeScope, renderScopeBlock, SCOPE_SYSTEM_RULE } from "../scope.js";
import { estimateTextTokens } from "../tokens.js";
import {
  isMemoryId,
  isMemoryWmItem,
  MAX_TOMBSTONE_REASON_LENGTH,
  type MemoryAttribution,
  type MemoryChunkRef,
  type MemoryObservation,
  type MemoryRelevance,
  type MemoryTaskState,
  type MemoryWmItem,
  type MemoryWmItemKind,
  relevanceValues,
} from "../types.js";

/**
 * The WM instruction. It asks for the scope's whole remaining work (later planned steps too), one subject per item, and
 * changed values as old → new with dates (plan 217 gate M-1: a theme paragraph hid an old value on LongMemEval).
 */
export const DEFAULT_WM_INSTRUCTION = [
  "You are working memory. Give each new STM record exactly one verdict: keep it (it stays as an event), summarize it with related records into one summary, or discard it as finished, out-of-scope, superseded or duplicate.",
  "Keep what the episode scope's whole remaining work needs, including later planned steps, not only the current task. Keep salient records (errors, corrections, denials, failed verifications) unless they are resolved.",
  "Use derive for an episode fact several records or items support. Each summary or fact covers one subject in a few sentences; write a changed value as old → new with its dates.",
  "supersedes names the existing WM items a new summary or fact replaces; other items stay. A record you give no verdict waits for the next pass.",
  "Relevance comes first; then aim at the token target as pressure: summarize or discard what later work does not need, but never drop needed material to meet it. Protected records cannot be discarded.",
  "Set neededLater to the scope step that needs an item when a later planned step depends on it.",
  "A record marked assistant proposal is what the assistant suggested, not what the user did; a summary merging user and assistant content says which side said what.",
].join(" ");

export type WmVerdict = "keep" | "summarize" | "discard";
export type WmDiscardReason = "finished" | "out-of-scope" | "superseded" | "duplicate";
export const wmDiscardReasonValues: readonly WmDiscardReason[] = ["finished", "out-of-scope", "superseded", "duplicate"];
export type WmRejection =
  | "unknown_id"
  | "already_processed"
  | "empty_text"
  | "citation_outside_active_set"
  | "invalid_arguments"
  | "protected";

/** The salience order the prompt asks WM to keep first (plan 218 Task 3). */
export const SALIENCE_PRIORITY: readonly SalienceSignal[] = ["correction", "denial", "error", "failed_verification"];

/** One record's verdict and what it became. `itemId` is absent for a discard. */
export interface WmRecordVerdict {
  readonly verdict: WmVerdict;
  readonly itemId?: string;
  readonly reason?: string;
}

export interface WmPassOutput {
  readonly items: readonly MemoryWmItem[];
  /** Verdicts by STM record id, in the order they were given. */
  readonly verdicts: ReadonlyMap<string, WmRecordVerdict>;
  readonly supersededItemIds: readonly string[];
  /** The model's last turn stopped on its output limit with no call (plan 218 Task 6); absent for the deterministic policy. */
  readonly endedAtOutputCap?: boolean;
}

export interface RunWmOptions extends MemoryWorkerLimitOptions {
  /** The batch: the STM records this pass may give verdicts on, oldest first. */
  readonly records: readonly MemoryObservation[];
  /** The ledger, for the active WM items and to tell a known id outside the active set from an unknown one. */
  readonly ledger: ObservationalMemoryLedger;
  readonly salience?: ReadonlyMap<string, readonly SalienceSignal[]>;
  /** Protected records in the batch (`protectedRecords`): `discard` refuses them with `protected`, enforced here, not by the prompt. */
  readonly protections?: ReadonlyMap<string, ProtectionReason>;
  /** `wm.targetRatio`: the prompt states `targetRatio` × the batch's tokens as the items' target. */
  readonly targetRatio?: number;
  /**
   * Re-judgment (plan 218 Task 4): tombstoned records the first pass after a scope change is also sent. `keep` may bring
   * one back into WM as an event; no other verdict applies, and a record left alone stays tombstoned.
   */
  readonly rejudge?: readonly MemoryObservation[];
  /** The episode scope, rendered as a delimited data block (I11). Absent, the block says the episode is the current work. */
  readonly scope?: EpisodeScope;
  readonly taskState?: MemoryTaskState;
  readonly client: ModelClient;
  readonly maxTurns: number;
  readonly instruction?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
  readonly sessionId?: string;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
  /** End the pass after a turn whose calls all succeeded (default true); tests that read a second request turn it off. */
  readonly endAfterCleanTurn?: boolean;
}

const ID: JsonObject = { type: "string", pattern: "^[a-f0-9]{12}$" };
const IDS: JsonObject = { type: "array", minItems: 1, items: ID };
const RELEVANCE: JsonObject = { type: "string", enum: [...relevanceValues] };
const NEEDED_LATER: JsonObject = { type: "string", minLength: 1, description: "The scope step that needs this item later." };

export async function runWm(options: RunWmOptions): Promise<WmPassOutput> {
  const secrets = options.secrets ?? [];
  const batch = new Map(options.records.map((record) => [record.id, record]));
  const rejudge = new Map((options.rejudge ?? []).map((record) => [record.id, record]));
  const ledger = options.ledger;
  const tombstoned = ledger.tombstones ?? {};
  const knownRecords = new Map(ledger.observations.map((record) => [record.id, record]));
  const activeRecords = new Map(activeObservations(ledger).map((record) => [record.id, record]));
  const inputItems = new Map(activeWmItems(ledger).map((item) => [item.id, item]));
  const knownItems = new Set(ledger.wmItems.map((item) => item.id));
  const items: MemoryWmItem[] = [];
  const madeItems = new Map<string, MemoryWmItem>();
  const verdicts = new Map<string, WmRecordVerdict>();
  const superseded = new Set<string>();

  /** A record id that may take a verdict now. `keep` also takes a record sent for re-judgment. */
  const verdictId = (id: unknown, rejudged = false): WmRejection | undefined => {
    if (!isMemoryId(id)) return "unknown_id";
    if (rejudged && rejudge.has(id) && !verdicts.has(id)) return undefined;
    if (verdicts.has(id) || Object.hasOwn(tombstoned, id)) return "already_processed";
    if (batch.has(id)) return undefined;
    return knownRecords.has(id) || knownItems.has(id) ? "citation_outside_active_set" : "unknown_id";
  };
  /** An id a fact may cite: an active STM record, an active WM item, or an item this pass made. */
  const citableId = (id: unknown): WmRejection | undefined => {
    if (!isMemoryId(id)) return "unknown_id";
    if (activeRecords.has(id) || inputItems.has(id) || madeItems.has(id)) return undefined;
    return knownRecords.has(id) || knownItems.has(id) ? "citation_outside_active_set" : "unknown_id";
  };
  /** A WM item a summary or fact may supersede: one this pass was given and no call superseded yet. */
  const supersedableId = (id: unknown): WmRejection | undefined => {
    if (!isMemoryId(id)) return "unknown_id";
    if (inputItems.has(id) && !superseded.has(id)) return undefined;
    return knownItems.has(id) || knownRecords.has(id) || madeItems.has(id) ? "citation_outside_active_set" : "unknown_id";
  };
  const firstRejection = (ids: readonly unknown[], check: (id: unknown) => WmRejection | undefined) => {
    for (const id of ids) {
      const reason = check(id);
      if (reason) return { reason, id: typeof id === "string" ? id.slice(0, 32) : undefined };
    }
    return undefined;
  };
  const text = (value: unknown): string =>
    typeof value === "string" ? truncateText(redactSecrets(normalizeEventText(value), secrets)) : "";
  const relevance = (value: unknown, fallback: MemoryRelevance): MemoryRelevance =>
    (relevanceValues as readonly unknown[]).includes(value) ? (value as MemoryRelevance) : fallback;
  const result = (context: { toolCallId: string }, name: string, value: Record<string, unknown>): ToolResult => ({
    toolCallId: context.toolCallId,
    name,
    value: value as ToolResult["value"],
  });
  const reject = (context: { toolCallId: string }, name: string, rejection: { reason: WmRejection; id?: string }) =>
    result(context, name, { ok: false, reason: rejection.reason, ...(rejection.id ? { id: rejection.id } : {}) });
  const add = (item: MemoryWmItem): MemoryWmItem | undefined => {
    if (!isMemoryWmItem(item)) return undefined;
    if (!madeItems.has(item.id)) {
      items.push(item);
      madeItems.set(item.id, item);
    }
    return item;
  };
  /** Records and items a new item rests on: their chunks and time span carry over. */
  const sources = (ids: readonly string[]) => ({
    records: ids.flatMap((id) => batch.get(id) ?? activeRecords.get(id) ?? []),
    items: ids.flatMap((id) => inputItems.get(id) ?? madeItems.get(id) ?? []),
  });
  const ids = (value: unknown): readonly unknown[] => (Array.isArray(value) ? [...new Set(value)] : []);
  /** A `neededLater` scope reference, redacted and capped like a reason. */
  const neededLater = (value: unknown): { neededLater?: string } => {
    const ref = text(value).slice(0, MAX_TOMBSTONE_REASON_LENGTH);
    return ref ? { neededLater: ref } : {};
  };

  const keep: ToolDefinition = {
    name: "keep",
    description:
      "Keep one new STM record, or one earlier-discarded record sent for re-judgment, in working memory as an event. reason says what later work needs it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { stmId: ID, reason: { type: "string", minLength: 1 }, neededLater: NEEDED_LATER },
      required: ["stmId", "reason"],
    },
    execute(args, context) {
      const rejection = firstRejection([args.stmId], (id) => verdictId(id, true));
      if (rejection) return reject(context, "keep", rejection);
      const record = batch.get(args.stmId as string) ?? rejudge.get(args.stmId as string)!;
      const reason = text(args.reason);
      const item = add({
        id: createMemoryId("wm:event", record.id),
        kind: "event",
        text: record.description,
        relevance: record.relevance,
        citedIds: [record.id],
        ...chunksOf([record], []),
        ...(reason ? { reason: reason.slice(0, MAX_TOMBSTONE_REASON_LENGTH) } : {}),
        ...neededLater(args.neededLater),
        ...spanOf([record], []),
        ...attributionOf([record], []),
        tokenCount: record.tokenCount,
      });
      if (!item) return reject(context, "keep", { reason: "invalid_arguments" });
      verdicts.set(record.id, { verdict: "keep", itemId: item.id, ...(reason ? { reason } : {}) });
      return result(context, "keep", { ok: true, itemId: item.id });
    },
  };

  const summarize: ToolDefinition = {
    name: "summarize",
    description: "Replace several new STM records with one short summary of one subject. supersedes names existing WM items it replaces.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { stmIds: IDS, text: { type: "string", minLength: 1 }, relevance: RELEVANCE, supersedes: IDS, neededLater: NEEDED_LATER },
      required: ["stmIds", "text", "relevance"],
    },
    execute(args, context) {
      const stmIds = ids(args.stmIds);
      const supersedes = ids(args.supersedes);
      const rejection =
        (stmIds.length ? undefined : { reason: "unknown_id" as const }) ??
        firstRejection(stmIds, verdictId) ??
        firstRejection(supersedes, supersedableId);
      if (rejection) return reject(context, "summarize", rejection);
      const body = text(args.text);
      if (!body) return reject(context, "summarize", { reason: "empty_text" });
      const cited = stmIds as string[];
      const replaced = sources(supersedes as string[]).items;
      const records = sources(cited).records;
      const item = add({
        ...newItem("summary", body, relevance(args.relevance, "medium"), cited, records, replaced, supersedes as string[]),
        ...neededLater(args.neededLater),
      });
      if (!item) return reject(context, "summarize", { reason: "invalid_arguments" });
      for (const id of cited) verdicts.set(id, { verdict: "summarize", itemId: item.id });
      for (const id of supersedes as string[]) superseded.add(id);
      return result(context, "summarize", { ok: true, itemId: item.id });
    },
  };

  const derive: ToolDefinition = {
    name: "derive",
    description:
      "Record one episode fact that STM records or WM items support. It gives no verdict. supersedes names existing WM items it replaces.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1 },
        supportingIds: IDS,
        relevance: RELEVANCE,
        supersedes: IDS,
        neededLater: NEEDED_LATER,
      },
      required: ["text", "supportingIds", "relevance"],
    },
    execute(args, context) {
      const supportingIds = ids(args.supportingIds);
      const supersedes = ids(args.supersedes);
      const rejection =
        (supportingIds.length ? undefined : { reason: "unknown_id" as const }) ??
        firstRejection(supportingIds, citableId) ??
        firstRejection(supersedes, supersedableId);
      if (rejection) return reject(context, "derive", rejection);
      const body = text(args.text);
      if (!body) return reject(context, "derive", { reason: "empty_text" });
      const cited = supportingIds as string[];
      const support = sources(cited);
      const replaced = sources(supersedes as string[]).items;
      const item = add({
        ...newItem(
          "fact",
          body,
          relevance(args.relevance, "medium"),
          cited,
          support.records,
          [...support.items, ...replaced],
          supersedes as string[],
        ),
        ...neededLater(args.neededLater),
      });
      if (!item) return reject(context, "derive", { reason: "invalid_arguments" });
      for (const id of supersedes as string[]) superseded.add(id);
      return result(context, "derive", { ok: true, itemId: item.id });
    },
  };

  const discard: ToolDefinition = {
    name: "discard",
    description:
      "Drop one new STM record from working memory: finished, out-of-scope, superseded or duplicate. A protected record is refused.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { stmId: ID, reason: { type: "string", enum: [...wmDiscardReasonValues] } },
      required: ["stmId", "reason"],
    },
    execute(args, context) {
      const rejection = firstRejection([args.stmId], verdictId);
      if (rejection) return reject(context, "discard", rejection);
      if (!(wmDiscardReasonValues as readonly unknown[]).includes(args.reason))
        return reject(context, "discard", { reason: "invalid_arguments" });
      // I5: protections are code, not prompt. A protected record may be kept or summarized, never discarded.
      const protection = options.protections?.get(args.stmId as string);
      if (protection) return result(context, "discard", { ok: false, reason: "protected", id: args.stmId as string, protection });
      verdicts.set(args.stmId as string, { verdict: "discard", reason: args.reason as WmDiscardReason });
      return result(context, "discard", { ok: true });
    },
  };

  const limits = resolveMemoryWorkerLimits(options);
  const prompt = joinWorkerText(wmPromptLines(options, [...inputItems.values()]), limits.maxMessageBytes, "Working memory prompt");
  const system = [SCOPE_SYSTEM_RULE, DEFAULT_WM_INSTRUCTION, ...(options.instruction ? [options.instruction] : [])].join("\n\n");
  const loop = await runMemoryWorkerLoop({
    ...options,
    system,
    prompt,
    tools: [keep, summarize, derive, discard],
    // A clean turn ends the pass: the closing reply recorded nothing (gate M-1 sitting 2).
    endAfterCleanTurn: options.endAfterCleanTurn ?? true,
    // Past the per-turn call limit, refuse the extra calls (the model re-sends them next turn) instead of failing the
    // pass and losing its verdicts (gate M-1 sittings 3-4).
    onToolCallLimit: "refuse",
  });
  return { items, verdicts, supersededItemIds: [...superseded], ...(loop.endedAtOutputCap ? { endedAtOutputCap: true } : {}) };
}

/** The WM prompt: the scope block, the task state, the current WM items, the target, then the batch with its salience and protections. */
function* wmPromptLines(options: RunWmOptions, items: readonly MemoryWmItem[]): Generator<string> {
  yield renderScopeBlock(options.scope, options.taskState);
  // The task state renders in the WM request whether or not a scope is set: protections and later steps read it.
  if (options.scope && options.taskState) yield `## Current task\n${JSON.stringify(options.taskState)}`;
  yield "## Working memory items";
  if (!items.length) yield "- none";
  for (const item of items) yield `- [${item.id}] ${item.kind} (${item.relevance}) cites ${item.citedIds.join(", ")}: ${item.text}`;
  const batchTokens = options.records.reduce((sum, record) => sum + record.tokenCount, 0);
  if (options.targetRatio !== undefined) {
    const target = wmTargetTokens(batchTokens, options.targetRatio);
    const protectedTokens = protectedTokenCount(options.records, options.protections ?? new Map());
    yield `## Target\nThese records hold ${batchTokens} tokens; aim for items totalling at most ${target} tokens (ratio ${options.targetRatio}). Relevance first: the target is pressure, never a reason to drop what later work needs.${protectedTokens > target ? ` Protected records alone hold ${protectedTokens} tokens, over the target: keep them and discard nothing more to meet it.` : ""}`;
  }
  const salient = salienceOrder(options.records, options.salience);
  if (salient.length) yield `## Keep first (salience order: ${SALIENCE_PRIORITY.join(", ")})\n${salient.join(", ")}`;
  yield `## New STM records (${options.records.length}; give each at most one verdict)`;
  for (const record of options.records) {
    const count = (record.count ?? 1) > 1 ? ` ×${record.count}` : "";
    const chunks = record.chunkRefs?.length
      ? ` [chunks: ${record.chunkRefs.length}, ${record.chunkRefs.reduce((sum, ref) => sum + ref.bytes, 0)} bytes]`
      : "";
    const salience = options.salience?.get(record.id);
    const protection = options.protections?.get(record.id);
    yield `- [${record.id}] ${record.observedAt ?? record.timestamp} ${attributionLabel(record.kind, record.attribution, isAssistantProposal(record))}${count} (${record.relevance})${chunks}${salience?.length ? ` salient: ${salience.join(", ")}` : ""}${protection ? ` protected: ${protection}` : ""}: ${record.description}`;
  }
  if (options.rejudge?.length) {
    yield `## Earlier discarded records (${options.rejudge.length}; the episode scope changed)\nKeep any record the new scope's remaining work needs; leave the rest, which stay discarded. Only keep applies to these.`;
    for (const record of options.rejudge)
      yield `- [${record.id}] ${record.observedAt ?? record.timestamp} ${record.kind} (${record.relevance})${record.chunkRefs?.length ? ` [chunks: ${record.chunkRefs.length}]` : ""}: ${record.description}`;
  }
}

/** `wm.targetRatio` × the tokens it applies to, rounded down. */
export function wmTargetTokens(tokens: number, targetRatio: number): number {
  return Math.floor(tokens * targetRatio);
}

/** Salient record ids, highest priority first (a correction before a denial, an error, a failed verification), oldest first within one. */
export function salienceOrder(
  records: readonly MemoryObservation[],
  salience: ReadonlyMap<string, readonly SalienceSignal[]> | undefined,
): readonly string[] {
  const rank = (id: string) => Math.min(...(salience?.get(id) ?? []).map((signal) => SALIENCE_PRIORITY.indexOf(signal)));
  return records
    .map((record, index) => ({ id: record.id, index, rank: rank(record.id) }))
    .filter((entry) => Number.isFinite(entry.rank))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.id);
}

export interface DeterministicWmOptions {
  readonly records: readonly MemoryObservation[];
  readonly protections: ReadonlyMap<string, ProtectionReason>;
  readonly salience?: ReadonlyMap<string, readonly SalienceSignal[]>;
  readonly targetRatio: number;
}

/**
 * `wm.policy: "deterministic"` (plan 218 Task 3): no model call. Protected records, outcomes and salient records are
 * kept; nothing is summarised; the rest is discarded lowest relevance first, oldest first within a relevance, until
 * the kept tokens reach `targetRatio` × the batch's tokens. Every record gets a verdict. A discard's reason is `budget`.
 */
export function deterministicWm(options: DeterministicWmOptions): WmPassOutput {
  const total = options.records.reduce((sum, record) => sum + record.tokenCount, 0);
  const target = wmTargetTokens(total, options.targetRatio);
  const fixed = (record: MemoryObservation) =>
    options.protections.has(record.id) || record.kind === "outcome" || (options.salience?.get(record.id)?.length ?? 0) > 0;
  const candidates = options.records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => !fixed(record))
    .sort((a, b) => relevanceValues.indexOf(a.record.relevance) - relevanceValues.indexOf(b.record.relevance) || a.index - b.index);
  const discarded = new Set<string>();
  let kept = total;
  for (const { record } of candidates) {
    if (kept <= target) break;
    discarded.add(record.id);
    kept -= record.tokenCount;
  }
  const items: MemoryWmItem[] = [];
  const verdicts = new Map<string, WmRecordVerdict>();
  for (const record of options.records) {
    if (discarded.has(record.id)) {
      verdicts.set(record.id, { verdict: "discard", reason: "budget" });
      continue;
    }
    const protection = options.protections.get(record.id);
    const reason = protection ? `protected: ${protection}` : record.kind === "outcome" ? "outcome" : "within target";
    const item: MemoryWmItem = {
      id: createMemoryId("wm:event", record.id),
      kind: "event",
      text: record.description,
      relevance: record.relevance,
      citedIds: [record.id],
      ...chunksOf([record], []),
      reason,
      ...spanOf([record], []),
      ...attributionOf([record], []),
      tokenCount: record.tokenCount,
    };
    if (!isMemoryWmItem(item)) continue;
    items.push(item);
    verdicts.set(record.id, { verdict: "keep", itemId: item.id, reason });
  }
  return { items, verdicts, supersededItemIds: [] };
}

function newItem(
  kind: Exclude<MemoryWmItemKind, "event">,
  text: string,
  relevance: MemoryRelevance,
  citedIds: readonly string[],
  records: readonly MemoryObservation[],
  items: readonly MemoryWmItem[],
  supersedes: readonly string[],
): MemoryWmItem {
  return {
    id: createMemoryId(`wm:${kind}`, text, citedIds),
    kind,
    text,
    relevance,
    citedIds,
    ...chunksOf(records, items),
    ...(supersedes.length ? { supersedes } : {}),
    ...spanOf(records, items),
    ...attributionOf(records, items),
    tokenCount: estimateTextTokens(text),
  };
}

/** Task 4.1: the speaker side an item inherits from what it rests on (`attributionOfSources`). */
function attributionOf(records: readonly MemoryObservation[], items: readonly MemoryWmItem[]): { attribution?: MemoryAttribution } {
  const attribution = attributionOfSources(records, items);
  return attribution ? { attribution } : {};
}

/** The chunks an item inherits from the records and items it rests on, one ref per chunk id. */
function chunksOf(records: readonly MemoryObservation[], items: readonly MemoryWmItem[]): { chunkRefs?: readonly MemoryChunkRef[] } {
  const refs = new Map<string, MemoryChunkRef>();
  for (const ref of [...records.flatMap((record) => record.chunkRefs ?? []), ...items.flatMap((item) => item.chunkRefs ?? [])])
    if (!refs.has(ref.id)) refs.set(ref.id, ref);
  return refs.size ? { chunkRefs: [...refs.values()] } : {};
}

function spanOf(records: readonly MemoryObservation[], items: readonly MemoryWmItem[]): { observedFrom?: string; observedTo?: string } {
  const dates = [
    ...records.flatMap((record) => [record.observedAt ?? record.timestamp, record.lastAt]),
    ...items.flatMap((item) => [item.observedFrom, item.observedTo]),
  ]
    .filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}T/.test(date) && Number.isFinite(Date.parse(date)))
    .map((date) => new Date(date).toISOString())
    .sort();
  return dates.length ? { observedFrom: dates[0]!, observedTo: dates.at(-1)! } : {};
}

/** Longest WM item text, in characters: a few sentences (Task 2: one subject, short). */
export const MAX_WM_ITEM_CHARS = 1_200;

function truncateText(value: string): string {
  return value.length <= MAX_WM_ITEM_CHARS ? value : `${value.slice(0, MAX_WM_ITEM_CHARS - 1)}…`;
}
