/**
 * Working memory (plan 218 Task 2, design §5.4): verdicts on named STM records, incremental only (I6).
 *
 * Records the code already protects for the episode (`SETTLED_PROTECTIONS`) are kept as WM events first, with no model
 * call for them (plan 218.2 Task 5). The model then gives every other verdict in one `judge` call over short ordinals
 * (`r1…rN` records, `w1…wM` current items, `j1…jK` re-judged records): `keep` (the record becomes a WM `event`),
 * `summaries` (several records become one WM `summary`), `discard` (finished, out of scope, superseded or a duplicate),
 * and `facts` (an episode-scoped WM `fact` records or items support; it gives no verdict). Each entry is checked on its
 * own. A record left without a verdict stays on the STM surface for the next pass. Summaries and facts supersede only
 * the WM items they name; nothing replaces the WM set. The worker records nothing itself: the flush appends its items
 * and tombstones, which keep the 12-character ids.
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
  "You are working memory. Call judge once with a verdict for every new STM record (r1…rN): keep it (it stays as an event), fold it with related records into one summary, or discard it as finished, out-of-scope, superseded or duplicate.",
  "Keep what the episode scope's whole remaining work needs, including later planned steps, not only the current task. Keep salient records (errors, corrections, denials, failed verifications) unless they are resolved.",
  "Add a fact for an episode fact several records or items support. Each summary or fact covers one subject in a few sentences; write a changed value as old → new with its dates.",
  "supersedes names the existing WM items (w1…wM) a new summary or fact replaces; other items stay. A record you give no verdict waits for the next pass. Records under Already kept are settled: give them no verdict.",
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

/** Protections WM settles by code before the model is asked (plan 218.2 Task 5). `fact` and `needed_later` still go to the model: a summary may absorb them. */
export const SETTLED_PROTECTIONS: ReadonlySet<ProtectionReason | undefined> = new Set<ProtectionReason>([
  "constraint",
  "task_state",
  "unresolved_error",
  "open_question",
]);

/** Refused entries one `judge` result lists; the rest are counted in `applied` only by their absence. */
const MAX_JUDGE_REFUSALS = 64;

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
  /** A `neededLater` scope reference, redacted and capped like a reason. */
  const neededLater = (value: unknown): { neededLater?: string } => {
    const ref = text(value).slice(0, MAX_TOMBSTONE_REASON_LENGTH);
    return ref ? { neededLater: ref } : {};
  };

  /** One verdict or item, applied or refused: the code the four tools and `judge` share. */
  type Applied =
    | { readonly ok: true; readonly itemId?: string }
    | { readonly ok: false; readonly reason: WmRejection; readonly id?: string; readonly protection?: ProtectionReason };
  const refusal = (rejection: { reason: WmRejection; id?: string }): Applied => ({ ok: false, ...rejection });

  const applyKeep = (id: unknown, reasonText: unknown, later: unknown): Applied => {
    const rejection = firstRejection([id], (value) => verdictId(value, true));
    if (rejection) return refusal(rejection);
    const record = batch.get(id as string) ?? rejudge.get(id as string)!;
    const reason = text(reasonText).slice(0, MAX_TOMBSTONE_REASON_LENGTH);
    const item = add({ ...eventItem(record, reason), ...neededLater(later) });
    if (!item) return refusal({ reason: "invalid_arguments" });
    verdicts.set(record.id, { verdict: "keep", itemId: item.id, ...(reason ? { reason } : {}) });
    return { ok: true, itemId: item.id };
  };

  const applySummary = (
    recordIds: readonly unknown[],
    bodyText: unknown,
    rel: unknown,
    supersedes: readonly unknown[],
    later: unknown,
  ): Applied => {
    const rejection =
      (recordIds.length ? undefined : { reason: "unknown_id" as const }) ??
      firstRejection(recordIds, verdictId) ??
      firstRejection(supersedes, supersedableId);
    if (rejection) return refusal(rejection);
    const body = text(bodyText);
    if (!body) return refusal({ reason: "empty_text" });
    const cited = recordIds as string[];
    const replaced = sources(supersedes as string[]).items;
    const records = sources(cited).records;
    const item = add({
      ...newItem("summary", body, relevance(rel, "medium"), cited, records, replaced, supersedes as string[]),
      ...neededLater(later),
    });
    if (!item) return refusal({ reason: "invalid_arguments" });
    for (const id of cited) verdicts.set(id, { verdict: "summarize", itemId: item.id });
    for (const id of supersedes as string[]) superseded.add(id);
    return { ok: true, itemId: item.id };
  };

  const applyFact = (
    supportIds: readonly unknown[],
    bodyText: unknown,
    rel: unknown,
    supersedes: readonly unknown[],
    later: unknown,
  ): Applied => {
    const rejection =
      (supportIds.length ? undefined : { reason: "unknown_id" as const }) ??
      firstRejection(supportIds, citableId) ??
      firstRejection(supersedes, supersedableId);
    if (rejection) return refusal(rejection);
    const body = text(bodyText);
    if (!body) return refusal({ reason: "empty_text" });
    const cited = supportIds as string[];
    const support = sources(cited);
    const replaced = sources(supersedes as string[]).items;
    const item = add({
      ...newItem("fact", body, relevance(rel, "medium"), cited, support.records, [...support.items, ...replaced], supersedes as string[]),
      ...neededLater(later),
    });
    if (!item) return refusal({ reason: "invalid_arguments" });
    for (const id of supersedes as string[]) superseded.add(id);
    return { ok: true, itemId: item.id };
  };

  const applyDiscard = (id: unknown, reason: unknown): Applied => {
    const rejection = firstRejection([id], verdictId);
    if (rejection) return refusal(rejection);
    if (!(wmDiscardReasonValues as readonly unknown[]).includes(reason)) return refusal({ reason: "invalid_arguments" });
    // I5: protections are code, not prompt. A protected record may be kept or summarized, never discarded.
    const protection = options.protections?.get(id as string);
    if (protection) return { ok: false, reason: "protected", id: id as string, protection };
    verdicts.set(id as string, { verdict: "discard", reason: reason as WmDiscardReason });
    return { ok: true };
  };

  // Settled first (plan 218.2 Task 5): a record protected for the episode or until a link resolves it is kept as an event
  // by code, with its protection as the reason. The model is not asked for a verdict on it.
  const settled = options.records.filter((record) => SETTLED_PROTECTIONS.has(options.protections?.get(record.id)));
  for (const record of settled) applyKeep(record.id, `protected: ${options.protections!.get(record.id)}`, undefined);
  const offered = options.records.filter((record) => !verdicts.has(record.id));
  if (!offered.length && !rejudge.size) return { items, verdicts, supersededItemIds: [] };

  // Ordinals (plan 218.2 Task 5): `r1…rN` name the batch's records in order, `w1…wM` the current WM items, `j1…jK` the
  // records sent for re-judgment. They exist only inside this request; items, tombstones and recall keep the ids.
  const labels = new Map<string, string>();
  for (const [index, record] of options.records.entries()) labels.set(record.id, `r${index + 1}`);
  for (const [index, id] of [...inputItems.keys()].entries()) labels.set(id, `w${index + 1}`);
  for (const [index, id] of [...rejudge.keys()].entries()) labels.set(id, `j${index + 1}`);
  const byLabel = new Map([...labels].map(([id, label]) => [label, id]));
  /** An ordinal to its id: an integer names an `r` (or `j` for re-judged keeps); a string names `r4`, `w1` or `j2`. Anything else is unknown. */
  const resolve = (value: unknown, prefix: "r" | "w" | "j", allowed: readonly ("r" | "w" | "j")[] = [prefix]): string | undefined => {
    const label =
      typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? `${prefix}${value}`
        : typeof value === "string" && /^[rwj][1-9][0-9]{0,5}$/.test(value)
          ? value
          : undefined;
    return label && allowed.includes(label[0] as "r" | "w" | "j") ? byLabel.get(label) : undefined;
  };
  /** An unresolvable ordinal stays unknown: it can never name a record outside the batch. */
  const mapped = (values: readonly unknown[], prefix: "r" | "w" | "j", allowed?: readonly ("r" | "w" | "j")[]) =>
    values.map((value) => resolve(value, prefix, allowed) ?? `unknown:${String(value).slice(0, 16)}`);
  const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
  const entries = (value: unknown): readonly Record<string, unknown>[] =>
    list(value).map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {}));

  const ORDINALS: JsonObject = { type: "array", items: { type: "integer", minimum: 1 } };
  const ITEM_ORDINALS: JsonObject = { type: "array", items: { type: "string", pattern: "^w[1-9][0-9]*$" } };
  const judge: ToolDefinition = {
    name: "judge",
    description:
      'Give every verdict for this batch in one call. Records are r1…rN, current working-memory items w1…wM, re-judged records j1…jK. keep: records that stay as events (r, or j for a re-judged record). discard: records by reason. summaries: several records folded into one summary of one subject. facts: episode facts that records or items support (support lists "r4" or "w1"); a fact gives no verdict. supersedes lists the w items a summary or fact replaces. A protected record cannot be discarded. Each entry is checked on its own; refused entries are listed so you can fix them.',
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        keep: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              r: { type: "integer", minimum: 1 },
              j: { type: "integer", minimum: 1 },
              reason: { type: "string", minLength: 1 },
              neededLater: NEEDED_LATER,
            },
            required: ["reason"],
          },
        },
        discard: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(wmDiscardReasonValues.map((reason) => [reason, ORDINALS])),
        },
        summaries: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              of: { ...ORDINALS, minItems: 1 },
              text: { type: "string", minLength: 1 },
              relevance: RELEVANCE,
              supersedes: ITEM_ORDINALS,
              neededLater: NEEDED_LATER,
            },
            required: ["of", "text", "relevance"],
          },
        },
        facts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string", minLength: 1 },
              support: { type: "array", minItems: 1, items: { type: "string", pattern: "^[rw][1-9][0-9]*$" } },
              relevance: RELEVANCE,
              supersedes: ITEM_ORDINALS,
              neededLater: NEEDED_LATER,
            },
            required: ["text", "support", "relevance"],
          },
        },
      },
    },
    execute(args, context) {
      const refused: JsonObject[] = [];
      let applied = 0;
      const note = (entry: string, outcome: Applied, given?: unknown) => {
        if (outcome.ok) {
          applied += 1;
          return;
        }
        if (refused.length >= MAX_JUDGE_REFUSALS) return;
        const label = outcome.id ? labels.get(outcome.id) : undefined;
        refused.push({
          entry,
          reason: outcome.reason,
          ...(label
            ? { ordinal: label }
            : typeof given === "number" || typeof given === "string"
              ? { ordinal: String(given).slice(0, 16) }
              : {}),
          ...(outcome.protection ? { protection: outcome.protection } : {}),
        });
      };
      entries(args.keep).forEach((entry, index) => {
        const both = entry.r !== undefined && entry.j !== undefined;
        const id = both ? undefined : entry.j !== undefined ? resolve(entry.j, "j") : resolve(entry.r, "r");
        note(
          `keep[${index}]`,
          id ? applyKeep(id, entry.reason, entry.neededLater) : refusal({ reason: both ? "invalid_arguments" : "unknown_id" }),
          entry.j ?? entry.r,
        );
      });
      entries(args.summaries).forEach((entry, index) => {
        const of = [...new Set(list(entry.of))];
        note(
          `summaries[${index}]`,
          applySummary(mapped(of, "r"), entry.text, entry.relevance, mapped([...new Set(list(entry.supersedes))], "w"), entry.neededLater),
        );
      });
      const discards =
        args.discard && typeof args.discard === "object" && !Array.isArray(args.discard) ? (args.discard as Record<string, unknown>) : {};
      for (const [reason, ordinals] of Object.entries(discards))
        list(ordinals).forEach((value, index) => {
          const id = resolve(value, "r");
          note(
            `discard.${reason.slice(0, 32)}[${index}]`,
            !(wmDiscardReasonValues as readonly string[]).includes(reason)
              ? refusal({ reason: "invalid_arguments" })
              : id
                ? applyDiscard(id, reason)
                : refusal({ reason: "unknown_id" }),
            value,
          );
        });
      entries(args.facts).forEach((entry, index) => {
        const support = mapped([...new Set(list(entry.support))], "r", ["r", "w"]);
        note(
          `facts[${index}]`,
          applyFact(support, entry.text, entry.relevance, mapped([...new Set(list(entry.supersedes))], "w"), entry.neededLater),
        );
      });
      const unjudged = offered.filter((record) => !verdicts.has(record.id)).length;
      return result(context, "judge", {
        ok: refused.length === 0,
        applied,
        ...(refused.length ? { refused } : {}),
        unjudged,
      });
    },
  };

  const limits = resolveMemoryWorkerLimits(options);
  const prompt = joinWorkerText(
    wmPromptLines(options, [...inputItems.values()], offered, settled, (id) => labels.get(id)),
    limits.maxMessageBytes,
    "Working memory prompt",
  );
  const system = [SCOPE_SYSTEM_RULE, DEFAULT_WM_INSTRUCTION, ...(options.instruction ? [options.instruction] : [])].join("\n\n");
  const loop = await runMemoryWorkerLoop({
    ...options,
    system,
    prompt,
    tools: [judge],
    // A clean turn ends the pass: the closing reply recorded nothing (gate M-1 sitting 2).
    endAfterCleanTurn: options.endAfterCleanTurn ?? true,
    // Past the per-turn call limit, refuse the extra calls (the model re-sends them next turn) instead of failing the
    // pass and losing its verdicts (gate M-1 sittings 3-4).
    onToolCallLimit: "refuse",
  });
  return { items, verdicts, supersededItemIds: [...superseded], ...(loop.endedAtOutputCap ? { endedAtOutputCap: true } : {}) };
}

/** The WM prompt: the scope block, the task state, the current WM items, the target, then the batch with its salience and protections. */
function* wmPromptLines(
  options: RunWmOptions,
  items: readonly MemoryWmItem[],
  offered: readonly MemoryObservation[],
  settled: readonly MemoryObservation[],
  label: (id: string) => string | undefined,
): Generator<string> {
  yield renderScopeBlock(options.scope, options.taskState);
  // The task state renders in the WM request whether or not a scope is set: protections and later steps read it.
  if (options.scope && options.taskState) yield `## Current task\n${JSON.stringify(options.taskState)}`;
  yield "## Working memory items";
  if (!items.length) yield "- none";
  // An item's citations outside this batch have no ordinal: they are counted, never shown as ids.
  for (const item of items) {
    const cited = item.citedIds.map(label).filter((value): value is string => value !== undefined);
    const older = item.citedIds.length - cited.length;
    const cites = [...cited, ...(older ? [`${older} earlier record${older > 1 ? "s" : ""}`] : [])].join(", ");
    yield `- [${label(item.id)}] ${item.kind} (${item.relevance}) cites ${cites}: ${item.text}`;
  }
  const batchTokens = options.records.reduce((sum, record) => sum + record.tokenCount, 0);
  if (options.targetRatio !== undefined) {
    const target = wmTargetTokens(batchTokens, options.targetRatio);
    const protectedTokens = protectedTokenCount(options.records, options.protections ?? new Map());
    yield `## Target\nThese records hold ${batchTokens} tokens; aim for items totalling at most ${target} tokens (ratio ${options.targetRatio}). Relevance first: the target is pressure, never a reason to drop what later work needs.${protectedTokens > target ? ` Protected records alone hold ${protectedTokens} tokens, over the target: keep them and discard nothing more to meet it.` : ""}`;
  }
  const line = (record: MemoryObservation) => {
    const count = (record.count ?? 1) > 1 ? ` ×${record.count}` : "";
    const chunks = record.chunkRefs?.length
      ? ` [chunks: ${record.chunkRefs.length}, ${record.chunkRefs.reduce((sum, ref) => sum + ref.bytes, 0)} bytes]`
      : "";
    const salience = options.salience?.get(record.id);
    const protection = options.protections?.get(record.id);
    return `- [${label(record.id)}] ${record.observedAt ?? record.timestamp} ${attributionLabel(record.kind, record.attribution, isAssistantProposal(record))}${count} (${record.relevance})${chunks}${salience?.length ? ` salient: ${salience.join(", ")}` : ""}${protection ? ` protected: ${protection}` : ""}: ${record.description}`;
  };
  if (settled.length) {
    yield `## Already kept (${settled.length}; protected, kept by code: give them no verdict)`;
    for (const record of settled) yield line(record);
  }
  const salient = salienceOrder(offered, options.salience);
  if (salient.length) yield `## Keep first (salience order: ${SALIENCE_PRIORITY.join(", ")})\n${salient.map(label).join(", ")}`;
  yield `## New STM records (${offered.length}; give each at most one verdict)`;
  for (const record of offered) yield line(record);
  if (options.rejudge?.length) {
    yield `## Earlier discarded records (${options.rejudge.length}; the episode scope changed)\nKeep any record the new scope's remaining work needs; leave the rest, which stay discarded. Only keep applies to these.`;
    for (const record of options.rejudge)
      yield `- [${label(record.id)}] ${record.observedAt ?? record.timestamp} ${record.kind} (${record.relevance})${record.chunkRefs?.length ? ` [chunks: ${record.chunkRefs.length}]` : ""}: ${record.description}`;
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
    const item = eventItem(record, reason);
    if (!isMemoryWmItem(item)) continue;
    items.push(item);
    verdicts.set(record.id, { verdict: "keep", itemId: item.id, reason });
  }
  return { items, verdicts, supersededItemIds: [] };
}

/** A record kept as a WM event: its description, chunks, span and side carry over. */
function eventItem(record: MemoryObservation, reason: string): MemoryWmItem {
  return {
    id: createMemoryId("wm:event", record.id),
    kind: "event",
    text: record.description,
    relevance: record.relevance,
    citedIds: [record.id],
    ...chunksOf([record], []),
    ...(reason ? { reason } : {}),
    ...spanOf([record], []),
    ...attributionOf([record], []),
    tokenCount: record.tokenCount,
  };
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
