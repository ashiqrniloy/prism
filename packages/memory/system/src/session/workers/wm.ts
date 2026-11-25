/**
 * Working memory (plan 218 Task 2, design §5.4): verdicts on named STM records, incremental only (I6).
 *
 * Records the code already protects for the episode (`SETTLED_PROTECTIONS`) are kept as WM events first, with no model
 * call for them (plan 218.2 Task 5). The model then gives every other verdict in one `judge` call over short ordinals
 * (`r1…rN` records, `w1…wM` current items, `j1…jK` re-judged records, `a1…aL` earlier records for coming scope steps): `keep` (the record becomes a WM `event`),
 * `summaries` (several records become one WM `summary`), `discard` (finished, out of scope, superseded or a duplicate),
 * and `facts` (an episode-scoped WM `fact` records or items support; it gives no verdict). Each entry is checked on its
 * own. A record left without a verdict stays on the STM surface for the next pass. Summaries and facts supersede only
 * the WM items they name; nothing replaces the WM set. The worker records nothing itself: the flush appends its items
 * and tombstones, which keep the 12-character ids.
 *
 * Plan 218.5 Task 3 put five rules in code (the 2026-11-22 critique's defects): an event kept from a record the code
 * still protects is never replaced; one summary or fact replaces at most `MAX_WM_SUPERSEDES` items; an item's relevance
 * is the highest among what it cites, never the model's rating; its time span comes from the STM records behind what it
 * cites, never from the items it replaces; and a fact replaces an item the user stated only when it cites a newer user
 * record. The flush holds the other two: a pass runs on pressure only, and a durable record or a user statement is
 * never in a batch.
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
import { type ProtectionReason, protectedRecords, protectedTokenCount } from "../protections.js";
import type { SalienceSignal } from "../salience.js";
import {
  type EpisodeScope,
  isReleasableWmItem,
  parseNeededLaterSteps,
  renderScopeBlock,
  resolveScopeProgress,
  SCOPE_SYSTEM_RULE,
  type ScopeProgress,
} from "../scope.js";
import { estimateTextTokens } from "../tokens.js";
import {
  isMemoryId,
  isMemoryWmItem,
  MAX_TOMBSTONE_REASON_LENGTH,
  type MemoryAttribution,
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
  "supersedes names the existing WM items (w1…wM) a new summary or fact replaces, at most 3; other items stay. An item kept from a protected record cannot be replaced, and a fact replaces an item the user stated only when it cites a newer user record. A record you give no verdict waits for the next pass. Records under Already kept are settled: give them no verdict.",
  "Relevance comes first; then aim at the token target as pressure: summarize or discard what later work does not need, but never drop needed material to meet it. Protected records cannot be discarded.",
  'Set neededLater to the scope step that needs an item when a later planned step depends on it. Mark a remaining scope step finished via finishedSteps only when citing STM outcome records with status "passed". Release items listed under Items for finished steps via discard.finished when no longer needed.',
  "Earlier records for coming steps (a1…aL) are past records code matched to a remaining scope step: keep one (keep with a) only when that step will need it; it returns as an event for that step. Leave the rest; no other verdict applies to them.",
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
  | "protected"
  | "too_many_supersedes"
  | "user_item_needs_newer_user_record"
  | "unsupported_step_finish"
  | "unknown_step";

/**
 * WM items one summary or fact may replace (plan 218.5 Task 3). Uncapped, one fact replaced 25 items in a screen
 * session, and its one stale clause then stood for all of them.
 */
export const MAX_WM_SUPERSEDES = 3;

/** The salience order the prompt asks WM to keep first (plan 218 Task 3). */
export const SALIENCE_PRIORITY: readonly SalienceSignal[] = ["correction", "denial", "error", "failed_verification"];

/** One record's verdict and what it became. `itemId` is absent for a discard. */
export interface WmRecordVerdict {
  readonly verdict: WmVerdict;
  readonly itemId?: string;
  readonly reason?: string;
}

/** One scope step WM marked finished in this pass with cited passed-outcome ids. */
export interface WmFinishedStep {
  readonly step: number;
  readonly evidenceIds: readonly string[];
}

export interface WmPassOutput {
  readonly items: readonly MemoryWmItem[];
  /** Verdicts by STM record id, in the order they were given. */
  readonly verdicts: ReadonlyMap<string, WmRecordVerdict>;
  readonly supersededItemIds: readonly string[];
  /** Scope steps marked finished in this pass and verified against cited passed outcomes. */
  readonly finishedSteps?: readonly WmFinishedStep[];
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
  /** `wm.protectRequestTasks`, for the protections of the records current WM events were kept from (default 3). */
  readonly protectRequestTasks?: number;
  /** `wm.targetRatio`: the prompt states `targetRatio` × the batch's tokens as the items' target. */
  readonly targetRatio?: number;
  /**
   * Re-judgment (plan 218 Task 4): tombstoned records the first pass after a scope change is also sent. `keep` may bring
   * one back into WM as an event; no other verdict applies, and a record left alone stays tombstoned.
   */
  readonly rejudge?: readonly MemoryObservation[];
  /**
   * Look-ahead (plan 218.3 Task 8): earlier records code matched to a remaining scope step (`selectLookAheadRecords`).
   * `keep` may bring one into WM as an event whose `neededLater` is that step; no other verdict applies.
   */
  readonly lookAhead?: readonly { readonly record: MemoryObservation; readonly step: number }[];
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

const NEEDED_LATER: JsonObject = { type: "string", minLength: 1, description: "The scope step that needs this item later." };

export async function runWm(options: RunWmOptions): Promise<WmPassOutput> {
  const secrets = options.secrets ?? [];
  const batch = new Map(options.records.map((record) => [record.id, record]));
  const rejudge = new Map((options.rejudge ?? []).map((record) => [record.id, record]));
  const lookAhead = new Map(
    (options.lookAhead ?? [])
      .filter(({ record }) => !batch.has(record.id) && !rejudge.has(record.id))
      .map((entry) => [entry.record.id, entry]),
  );
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
  const progress = options.scope ? resolveScopeProgress(options.scope, ledger.scopeSteps) : undefined;
  const stepOrdinals = new Set(progress?.steps.map((step) => step.step) ?? []);
  const finishedStepSet = new Set(progress?.finished.map((step) => step.step) ?? []);
  const acceptedFinishedSteps = new Map<number, readonly string[]>();
  const releasable = progress ? [...inputItems.values()].filter((item) => isReleasableWmItem(item.neededLater, finishedStepSet)) : [];
  const ledgerOrder = new Map(ledger.observations.map((record, index) => [record.id, index]));
  const ledgerItems = new Map(ledger.wmItems.map((item) => [item.id, item]));
  /** The STM records ids rest on: a record itself, or the records behind a WM item, through the items it cites. */
  const recordsBehind = (ids: readonly string[], seen = new Set<string>()): MemoryObservation[] =>
    ids.flatMap((id) => {
      if (seen.has(id)) return [];
      seen.add(id);
      const record = batch.get(id) ?? knownRecords.get(id);
      if (record) return [record];
      const item = madeItems.get(id) ?? ledgerItems.get(id);
      return item ? recordsBehind(item.citedIds, seen) : [];
    });
  // Protected items (plan 218.5 Task 3): a current WM event whose record the code protects for the episode or until a
  // link resolves it (`SETTLED_PROTECTIONS`). Read from the ledger on every pass, so an error a passed outcome resolved,
  // or a constraint a later record superseded, frees its event. No summary or fact may replace one.
  const events = [...inputItems.values()].filter((item) => item.kind === "event");
  const eventProtections = protectedRecords(
    ledger,
    events.flatMap((item) => item.citedIds.flatMap((id) => knownRecords.get(id) ?? [])),
    {
      ...(options.salience ? { salience: options.salience } : {}),
      ...(options.protectRequestTasks === undefined ? {} : { protectRequestTasks: options.protectRequestTasks }),
      finishedSteps: finishedStepSet,
    },
  );
  const protectedItems = new Map<string, ProtectionReason>();
  for (const item of events) {
    const reason = item.citedIds
      .map((id) => eventProtections.get(id))
      .find((value) => value !== undefined && SETTLED_PROTECTIONS.has(value));
    if (reason) protectedItems.set(item.id, reason);
  }

  /** A record id that may take a verdict now. `keep` also takes a record sent for re-judgment or look-ahead. */
  const verdictId = (id: unknown, rejudged = false): WmRejection | undefined => {
    if (!isMemoryId(id)) return "unknown_id";
    if (rejudged && (rejudge.has(id) || lookAhead.has(id))) return verdicts.has(id) ? "already_processed" : undefined;
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
  /** A WM item a summary or fact may supersede: one this pass was given, not protected, and that no call superseded yet. */
  const supersedableId = (id: unknown): WmRejection | undefined => {
    if (!isMemoryId(id)) return "unknown_id";
    if (protectedItems.has(id)) return "protected";
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
  /** Records and items a new item rests on: their time span and speaker side carry over. */
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
  const refusal = (rejection: { reason: WmRejection; id?: string }): Applied => {
    const protection = rejection.reason === "protected" && rejection.id ? protectedItems.get(rejection.id) : undefined;
    return { ok: false, ...rejection, ...(protection ? { protection } : {}) };
  };
  /** Why a summary or fact may not replace `ids`: more than the cap, or the first item that is not supersedable. */
  const supersedeRejection = (ids: readonly unknown[]) =>
    ids.length > MAX_WM_SUPERSEDES ? { reason: "too_many_supersedes" as const } : firstRejection(ids, supersedableId);

  const applyKeep = (id: unknown, reasonText: unknown, later: unknown): Applied => {
    const rejection = firstRejection([id], (value) => verdictId(value, true));
    if (rejection) return refusal(rejection);
    const ahead = lookAhead.get(id as string);
    const record = batch.get(id as string) ?? rejudge.get(id as string) ?? ahead!.record;
    const reason = text(reasonText).slice(0, MAX_TOMBSTONE_REASON_LENGTH);
    // A look-ahead keep is for the step code matched it to: its neededLater names that step, whatever the model wrote.
    const item = add({ ...eventItem(record, reason), ...(ahead ? { neededLater: `step ${ahead.step}` } : neededLater(later)) });
    if (!item) return refusal({ reason: "invalid_arguments" });
    verdicts.set(record.id, { verdict: "keep", itemId: item.id, ...(reason ? { reason } : {}) });
    return { ok: true, itemId: item.id };
  };

  const applySummary = (recordIds: readonly unknown[], bodyText: unknown, supersedes: readonly unknown[], later: unknown): Applied => {
    const rejection =
      (recordIds.length ? undefined : { reason: "unknown_id" as const }) ??
      firstRejection(recordIds, verdictId) ??
      supersedeRejection(supersedes);
    if (rejection) return refusal(rejection);
    const body = text(bodyText);
    if (!body) return refusal({ reason: "empty_text" });
    const cited = recordIds as string[];
    const replaced = sources(supersedes as string[]).items;
    const records = sources(cited).records;
    const item = add({
      ...newItem("summary", body, maxRelevance(records), cited, recordsBehind(cited), records, replaced, supersedes as string[]),
      ...neededLater(later),
    });
    if (!item) return refusal({ reason: "invalid_arguments" });
    for (const id of cited) verdicts.set(id, { verdict: "summarize", itemId: item.id });
    for (const id of supersedes as string[]) superseded.add(id);
    return { ok: true, itemId: item.id };
  };

  const applyFact = (supportIds: readonly unknown[], bodyText: unknown, supersedes: readonly unknown[], later: unknown): Applied => {
    const rejection =
      (supportIds.length ? undefined : { reason: "unknown_id" as const }) ??
      firstRejection(supportIds, citableId) ??
      supersedeRejection(supersedes);
    if (rejection) return refusal(rejection);
    const body = text(bodyText);
    if (!body) return refusal({ reason: "empty_text" });
    const cited = supportIds as string[];
    const support = sources(cited);
    const replaced = sources(supersedes as string[]).items;
    // Attribution precedence (plan 218.5 Task 3): a fact replaces an item the user stated only when it cites a user
    // record recorded after every record behind that item. A tool result or a stale document cannot outrank the user;
    // an item whose records the ledger does not hold cannot be shown older, so it stays.
    const newestUserRecord = Math.max(-1, ...support.records.filter(fromUser).map((record) => ledgerOrder.get(record.id) ?? -1));
    for (const target of replaced.filter(fromUser)) {
      const behind = recordsBehind(target.citedIds);
      const newest = behind.length
        ? Math.max(...behind.map((record) => ledgerOrder.get(record.id) ?? Number.POSITIVE_INFINITY))
        : Number.POSITIVE_INFINITY;
      if (!(newestUserRecord > newest)) return refusal({ reason: "user_item_needs_newer_user_record", id: target.id });
    }
    const item = add({
      ...newItem(
        "fact",
        body,
        maxRelevance([...support.records, ...support.items]),
        cited,
        recordsBehind(cited),
        support.records,
        [...support.items, ...replaced],
        supersedes as string[],
      ),
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

  const applyReleaseItem = (id: string): Applied => {
    const item = inputItems.get(id);
    if (!item) return refusal({ reason: "unknown_id" });
    if (superseded.has(id)) return { ok: false, reason: "already_processed", id };
    const steps = parseNeededLaterSteps(item.neededLater);
    if (steps.length === 0) return { ok: false, reason: "invalid_arguments", id };
    const allFinished = steps.every((step) => finishedStepSet.has(step) || acceptedFinishedSteps.has(step));
    if (!allFinished) return { ok: false, reason: "protected", id, protection: "needed_later" };
    superseded.add(id);
    return { ok: true, itemId: id };
  };

  const applyFinishedStep = (stepValue: unknown, evidenceValues: readonly unknown[]): Applied => {
    if (!progress) return refusal({ reason: "unknown_step" });
    if (typeof stepValue !== "number" || !Number.isSafeInteger(stepValue) || stepValue < 1) return refusal({ reason: "invalid_arguments" });
    if (!stepOrdinals.has(stepValue)) return refusal({ reason: "unknown_step" });
    if (finishedStepSet.has(stepValue) || acceptedFinishedSteps.has(stepValue)) return refusal({ reason: "already_processed" });
    if (!evidenceValues.length) return refusal({ reason: "unsupported_step_finish" });
    const evidenceIds: string[] = [];
    for (const raw of [...new Set(evidenceValues)]) {
      const id = resolve(raw, "r");
      if (!id) return refusal({ reason: "unknown_id" });
      const record = batch.get(id) ?? activeRecords.get(id) ?? knownRecords.get(id);
      if (!record) return refusal({ reason: "unknown_id" });
      if (record.kind !== "outcome" || record.status !== "passed") return { ok: false, reason: "unsupported_step_finish", id: record.id };
      evidenceIds.push(record.id);
    }
    acceptedFinishedSteps.set(stepValue, evidenceIds);
    return { ok: true };
  };

  // Settled first (plan 218.2 Task 5): a record protected for the episode or until a link resolves it is kept as an event
  // by code, with its protection as the reason. The model is not asked for a verdict on it.
  const settled = options.records.filter((record) => SETTLED_PROTECTIONS.has(options.protections?.get(record.id)));
  for (const record of settled) applyKeep(record.id, `protected: ${options.protections!.get(record.id)}`, undefined);
  const offered = options.records.filter((record) => !verdicts.has(record.id));
  if (!offered.length && !rejudge.size && !releasable.length) return { items, verdicts, supersededItemIds: [] };

  // Ordinals (plan 218.2 Task 5): `r1…rN` name the batch's records in order, `w1…wM` the current WM items, `j1…jK` the
  // records sent for re-judgment. They exist only inside this request; items, tombstones and recall keep the ids.
  const labels = new Map<string, string>();
  for (const [index, record] of options.records.entries()) labels.set(record.id, `r${index + 1}`);
  for (const [index, id] of [...inputItems.keys()].entries()) labels.set(id, `w${index + 1}`);
  for (const [index, id] of [...rejudge.keys()].entries()) labels.set(id, `j${index + 1}`);
  for (const [index, id] of [...lookAhead.keys()].entries()) labels.set(id, `a${index + 1}`);
  const byLabel = new Map([...labels].map(([id, label]) => [label, id]));
  type Prefix = "r" | "w" | "j" | "a";
  /** An ordinal to its id: an integer names an `r` (or `j`/`a` for re-judged and look-ahead keeps); a string names `r4`, `w1`, `j2` or `a1`. Anything else is unknown. */
  const resolve = (value: unknown, prefix: Prefix, allowed: readonly Prefix[] = [prefix]): string | undefined => {
    const label =
      typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? `${prefix}${value}`
        : typeof value === "string" && /^[rwja][1-9][0-9]{0,5}$/.test(value)
          ? value
          : undefined;
    return label && allowed.includes(label[0] as Prefix) ? byLabel.get(label) : undefined;
  };
  /** An unresolvable ordinal stays unknown: it can never name a record outside the batch. */
  const mapped = (values: readonly unknown[], prefix: Prefix, allowed?: readonly Prefix[]) =>
    values.map((value) => resolve(value, prefix, allowed) ?? `unknown:${String(value).slice(0, 16)}`);
  const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
  const entries = (value: unknown): readonly Record<string, unknown>[] =>
    list(value).map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {}));

  const ORDINALS: JsonObject = { type: "array", items: { type: "integer", minimum: 1 } };
  const FINISH_DISCARD_ORDINALS: JsonObject = {
    type: "array",
    items: {
      anyOf: [
        { type: "integer", minimum: 1 },
        { type: "string", pattern: "^[rw][1-9][0-9]*$" },
      ],
    },
  };
  const ITEM_ORDINALS: JsonObject = { type: "array", items: { type: "string", pattern: "^w[1-9][0-9]*$" } };
  const EVIDENCE_ORDINALS: JsonObject = {
    type: "array",
    minItems: 1,
    items: {
      anyOf: [
        { type: "string", pattern: "^r[1-9][0-9]*$" },
        { type: "integer", minimum: 1 },
      ],
    },
  };
  const judge: ToolDefinition = {
    name: "judge",
    description:
      'Give every verdict for this batch in one call. Records are r1…rN, current working-memory items w1…wM, re-judged records j1…jK, earlier records for coming steps a1…aL. keep: records that stay as events (r, j for a re-judged record, or a for an earlier record a coming step needs). discard: records by reason (finished also accepts w items offered under Items for finished steps). summaries: several records folded into one summary of one subject. facts: episode facts that records or items support (support lists "r4" or "w1"); a fact gives no verdict. finishedSteps: remaining scope steps proven done by cited STM passed-outcome records. supersedes lists the w items a summary or fact replaces: at most 3, and never an item kept from a protected record. A protected record cannot be discarded. Each entry is checked on its own; refused entries are listed so you can fix them.',
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
              a: { type: "integer", minimum: 1 },
              reason: { type: "string", minLength: 1 },
              neededLater: NEEDED_LATER,
            },
            required: ["reason"],
          },
        },
        discard: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            wmDiscardReasonValues.map((reason) => [reason, reason === "finished" ? FINISH_DISCARD_ORDINALS : ORDINALS]),
          ),
        },
        summaries: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              of: { ...ORDINALS, minItems: 1 },
              text: { type: "string", minLength: 1 },
              supersedes: ITEM_ORDINALS,
              neededLater: NEEDED_LATER,
            },
            required: ["of", "text"],
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
              supersedes: ITEM_ORDINALS,
              neededLater: NEEDED_LATER,
            },
            required: ["text", "support"],
          },
        },
        finishedSteps: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              step: { type: "integer", minimum: 1, description: "The 1-based ordinal of the finished scope step." },
              evidence: EVIDENCE_ORDINALS,
            },
            required: ["step", "evidence"],
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
      entries(args.finishedSteps).forEach((entry, index) => {
        note(`finishedSteps[${index}]`, applyFinishedStep(entry.step, list(entry.evidence)), entry.step);
      });
      entries(args.keep).forEach((entry, index) => {
        const named = (["r", "j", "a"] as const).filter((prefix) => entry[prefix] !== undefined);
        const several = named.length > 1;
        const id = several || !named.length ? undefined : resolve(entry[named[0]!], named[0]!);
        note(
          `keep[${index}]`,
          id ? applyKeep(id, entry.reason, entry.neededLater) : refusal({ reason: several ? "invalid_arguments" : "unknown_id" }),
          entry.a ?? entry.j ?? entry.r,
        );
      });
      entries(args.summaries).forEach((entry, index) => {
        const of = [...new Set(list(entry.of))];
        note(
          `summaries[${index}]`,
          applySummary(mapped(of, "r"), entry.text, mapped([...new Set(list(entry.supersedes))], "w"), entry.neededLater),
        );
      });
      const discards =
        args.discard && typeof args.discard === "object" && !Array.isArray(args.discard) ? (args.discard as Record<string, unknown>) : {};
      for (const [reason, ordinals] of Object.entries(discards))
        list(ordinals).forEach((value, index) => {
          const validReason = (wmDiscardReasonValues as readonly string[]).includes(reason);
          if (!validReason) {
            note(`discard.${reason.slice(0, 32)}[${index}]`, refusal({ reason: "invalid_arguments" }), value);
            return;
          }
          const rId = resolve(value, "r");
          const wId = !rId && reason === "finished" ? resolve(value, "w") : undefined;
          note(
            `discard.${reason.slice(0, 32)}[${index}]`,
            rId ? applyDiscard(rId, reason) : wId ? applyReleaseItem(wId) : refusal({ reason: "unknown_id" }),
            value,
          );
        });
      entries(args.facts).forEach((entry, index) => {
        const support = mapped([...new Set(list(entry.support))], "r", ["r", "w"]);
        note(`facts[${index}]`, applyFact(support, entry.text, mapped([...new Set(list(entry.supersedes))], "w"), entry.neededLater));
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
    wmPromptLines(options, [...inputItems.values()], offered, settled, (id) => labels.get(id), progress, releasable, [
      ...lookAhead.values(),
    ]),
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
  const finishedSteps = [...acceptedFinishedSteps].map(([step, evidenceIds]) => ({ step, evidenceIds }));
  return {
    items,
    verdicts,
    supersededItemIds: [...superseded],
    ...(finishedSteps.length ? { finishedSteps } : {}),
    ...(loop.endedAtOutputCap ? { endedAtOutputCap: true } : {}),
  };
}

/** The WM prompt: the scope block, the task state, the current WM items, releasable items, the target, then the batch with its salience and protections. */
function* wmPromptLines(
  options: RunWmOptions,
  items: readonly MemoryWmItem[],
  offered: readonly MemoryObservation[],
  settled: readonly MemoryObservation[],
  label: (id: string) => string | undefined,
  progress?: ScopeProgress,
  releasable: readonly MemoryWmItem[] = [],
  lookAhead: readonly { readonly record: MemoryObservation; readonly step: number }[] = [],
): Generator<string> {
  if (options.scope) yield renderScopeBlock(options.scope, progress);
  if (options.taskState) yield `## Current task\n${JSON.stringify(options.taskState)}`;
  yield "## Working memory items";
  if (!items.length) yield "- none";
  // An item's citations outside this batch have no ordinal: they are counted, never shown as ids.
  for (const item of items) {
    const cited = item.citedIds.map(label).filter((value): value is string => value !== undefined);
    const older = item.citedIds.length - cited.length;
    const cites = [...cited, ...(older ? [`${older} earlier record${older > 1 ? "s" : ""}`] : [])].join(", ");
    yield `- [${label(item.id)}] ${item.kind} (${item.relevance}) cites ${cites}: ${item.text}`;
  }
  if (releasable.length) {
    yield `## Items for finished steps (${releasable.length}; their neededLater steps are finished — discard with discard.finished: ["w1", ...] if no longer needed)`;
    for (const item of releasable)
      yield `- [${label(item.id)}] ${item.kind} (${item.relevance}) neededLater=${item.neededLater}: ${item.text}`;
  }
  const batchTokens = options.records.reduce((sum, record) => sum + record.tokenCount, 0);
  if (options.targetRatio !== undefined) {
    const target = wmTargetTokens(batchTokens, options.targetRatio);
    const protectedTokens = protectedTokenCount(options.records, options.protections ?? new Map());
    yield `## Target\nThese records hold ${batchTokens} tokens; aim for items totalling at most ${target} tokens (ratio ${options.targetRatio}). Relevance first: the target is pressure, never a reason to drop what later work needs.${protectedTokens > target ? ` Protected records alone hold ${protectedTokens} tokens, over the target: keep them and discard nothing more to meet it.` : ""}`;
  }
  const line = (record: MemoryObservation) => {
    const count = (record.count ?? 1) > 1 ? ` ×${record.count}` : "";
    const salience = options.salience?.get(record.id);
    const protection = options.protections?.get(record.id);
    return `- [${label(record.id)}] ${record.observedAt ?? record.timestamp} ${attributionLabel(record.kind, record.attribution, isAssistantProposal(record))}${count} (${record.relevance})${salience?.length ? ` salient: ${salience.join(", ")}` : ""}${protection ? ` protected: ${protection}` : ""}: ${record.description}`;
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
      yield `- [${label(record.id)}] ${record.observedAt ?? record.timestamp} ${record.kind} (${record.relevance}): ${record.description}`;
  }
  if (lookAhead.length) {
    yield `## Earlier records for coming steps (${lookAhead.length}; matched to a remaining scope step)\nKeep (keep with a) any record its step will need; it returns as an event for that step. Leave the rest. Only keep applies to these.`;
    for (const { record, step } of lookAhead)
      yield `- [${label(record.id)}] step ${step}: ${record.observedAt ?? record.timestamp} ${record.kind} (${record.relevance}): ${record.description}`;
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
 * `wm.policy: "deterministic"` (plan 218 Task 3): no model call. Protected records, salient records and outcomes of
 * high or critical relevance are kept; nothing is summarised; the rest is discarded lowest relevance first, oldest first
 * within a relevance, until the kept tokens reach `targetRatio` × the batch's tokens. Every record gets a verdict. A
 * discard's reason is `budget`. Plan 218.5 Task 7: a routine (medium or low) outcome is no longer kept unconditionally:
 * kept, every "task N finished" became its own item and the block grew one item per finished task.
 */
export function deterministicWm(options: DeterministicWmOptions): WmPassOutput {
  const total = options.records.reduce((sum, record) => sum + record.tokenCount, 0);
  const target = wmTargetTokens(total, options.targetRatio);
  const fixed = (record: MemoryObservation) =>
    options.protections.has(record.id) ||
    (record.kind === "outcome" && (record.relevance === "high" || record.relevance === "critical")) ||
    (options.salience?.get(record.id)?.length ?? 0) > 0;
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

/** A record kept as a WM event: its description, span and side carry over. */
function eventItem(record: MemoryObservation, reason: string): MemoryWmItem {
  return {
    id: createMemoryId("wm:event", record.id),
    kind: "event",
    text: record.description,
    relevance: record.relevance,
    citedIds: [record.id],
    ...(reason ? { reason } : {}),
    ...spanOf([record]),
    ...attributionOf([record], []),
    tokenCount: record.tokenCount,
  };
}

/**
 * A summary or fact. `spanRecords` are the STM records behind what it cites (its time span); `records` and `items` are
 * what its speaker side comes from, the items it replaces included.
 */
function newItem(
  kind: Exclude<MemoryWmItemKind, "event">,
  text: string,
  relevance: MemoryRelevance,
  citedIds: readonly string[],
  spanRecords: readonly MemoryObservation[],
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
    ...(supersedes.length ? { supersedes } : {}),
    ...spanOf(spanRecords),
    ...attributionOf(records, items),
    tokenCount: estimateTextTokens(text),
  };
}

/** Task 4.1: the speaker side an item inherits from what it rests on (`attributionOfSources`). */
function attributionOf(records: readonly MemoryObservation[], items: readonly MemoryWmItem[]): { attribution?: MemoryAttribution } {
  const attribution = attributionOfSources(records, items);
  return attribution ? { attribution } : {};
}

/** Whether a record or item carries user content (`user`, or `mixed` with the assistant's). */
function fromUser(source: { readonly attribution?: MemoryAttribution }): boolean {
  return source.attribution === "user" || source.attribution === "mixed";
}

/** Plan 218.5 Task 3: the highest relevance among an item's cited sources. The model's own rating is not read. */
function maxRelevance(sources: readonly { readonly relevance: MemoryRelevance }[]): MemoryRelevance {
  return sources.reduce<MemoryRelevance>(
    (max, source) => (relevanceValues.indexOf(source.relevance) > relevanceValues.indexOf(max) ? source.relevance : max),
    "low",
  );
}

/**
 * An item's time span: from the STM records behind what it cites only (plan 218.5 Task 3). An item it replaces lends
 * no date, so a summary that restates an old value does not read as the newest.
 */
function spanOf(records: readonly MemoryObservation[]): { observedFrom?: string; observedTo?: string } {
  const dates = records
    .flatMap((record) => [record.observedAt ?? record.timestamp, record.lastAt])
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
