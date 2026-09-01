import type {
  ContentBlock,
  Message,
  OwnershipScope,
  ProductionPersistenceStore,
  RunFeedbackRecord,
  RunRecord,
  SecretRedactor,
} from "@arnilo/prism";
import { resolveRedactor } from "@arnilo/prism";
import { defineDataset } from "./dataset.js";
import { EvalError } from "./errors.js";
import {
  DEFAULT_TRACE_PAGE_SIZE,
  DEFAULT_TRACE_PAGES,
  HARD_CURATION_ITEM_MAX_BYTES,
  HARD_TRACE_PAGE_SIZE,
  HARD_TRACE_PAGES,
} from "./limits.js";
import { limit as bound, createPersistenceTraceResolver, pages } from "./trace.js";
import type { Dataset, DatasetItem, EvaluationTrace, TraceLimits } from "./types.js";
import { mapPool, normalizeConcurrency } from "./util.js";

/** Redacted, bounded extraction for one resolved run, handed to `toItem`. */
export interface CuratedRun {
  readonly run: RunRecord;
  readonly trace: EvaluationTrace;
  /** First user message from the trace events (first message when no user role exists). */
  readonly input: Message | undefined;
  /** Concatenated text of the final assistant message; `""` when none. */
  readonly output: string;
  /** Latest feedback record for the run, when `store.feedback` is configured and returned it. */
  readonly feedback?: RunFeedbackRecord;
}

/** Host-mappable draft; `id` defaults to the run id. */
export interface CuratedItemDraft<TInput = unknown, TExpected = unknown> {
  readonly id?: string;
  readonly input: TInput;
  readonly expected?: TExpected;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type CurateToItem<TInput = unknown, TExpected = unknown> = (run: CuratedRun) => CuratedItemDraft<TInput, TExpected> | undefined;

/** One per-run worker outcome: either a curated item or a skip reason. */
type CurateOutcome<TInput, TExpected> = { readonly item: DatasetItem<TInput, TExpected> } | CurationSkip;

/** Default mapping: one run → one item keyed by run id. */
// ponytail: `expected` comes only from the feedback seam (`metadata.expected` of the
// human-graded RunFeedbackRecord), never re-derived from the recorded output; the
// output rides `metadata.output` for provenance and passes the same redactor/cap.
export const defaultCurateToItem: CurateToItem = (run) => ({
  id: run.run.id,
  input: run.input,
  expected: run.feedback?.metadata?.expected,
  metadata: { output: run.output },
});

export interface DatasetFromRunsInput<TInput = unknown, TExpected = unknown> {
  /** Bare run ids; resolved by one ownership-bounded scan of the run ledger. */
  readonly runIds?: readonly string[];
  /** Whole sessions: every run recorded under each session id is curated. */
  readonly sessionIds?: readonly string[];
  /** Existing dataset to append into; a new immutable version is returned. */
  readonly dataset: Dataset<TInput, TExpected>;
  readonly store: ProductionPersistenceStore;
  readonly ownership: OwnershipScope;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly toItem?: CurateToItem<TInput, TExpected>;
  readonly traceLimits?: TraceLimits;
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

export interface CurationSkip {
  readonly id: string;
  readonly reason: string;
}

export interface CurateResult<TInput = unknown, TExpected = unknown> {
  /** New immutable dataset version containing the prior items plus the curated ones. */
  readonly dataset: Dataset<TInput, TExpected>;
  readonly version?: string;
  readonly added: number;
  readonly skipped: readonly CurationSkip[];
}

function textOf(message: Message | undefined): string {
  return (message?.content ?? []).map((block: ContentBlock) => (block.type === "text" ? block.text : "")).join("");
}

function messageOf(record: { readonly event: { readonly type: string; readonly message?: Message } }): Message | undefined {
  return record.event.type === "message_started" || record.event.type === "message_finished" ? record.event.message : undefined;
}

function extractRunIO(trace: EvaluationTrace): { input: Message | undefined; output: string } {
  const messages = trace.events.map(messageOf).filter((message): message is Message => message !== undefined);
  const input = messages.find((message) => message.role === "user") ?? messages[0];
  const output = [...messages].reverse().find((message) => message.role === "assistant");
  return { input, output: textOf(output) };
}

function nextVersion(previous: string | undefined): string {
  const current = previous ?? "1";
  return /^\d+$/.test(current) ? String(Number(current) + 1) : `${current}-2`;
}

/** Append production runs to a dataset as a new immutable version: resolve → redact → map → append. */
export async function datasetFromRuns<TInput = unknown, TExpected = unknown>(
  input: DatasetFromRunsInput<TInput, TExpected>,
): Promise<CurateResult<TInput, TExpected>> {
  input.signal?.throwIfAborted();
  const concurrency = normalizeConcurrency(input.concurrency);
  const pageSize = bound(input.traceLimits?.pageSize, DEFAULT_TRACE_PAGE_SIZE, HARD_TRACE_PAGE_SIZE, "pageSize");
  const maxPages = bound(input.traceLimits?.maxPages, DEFAULT_TRACE_PAGES, HARD_TRACE_PAGES, "maxPages");
  const resolver = createPersistenceTraceResolver(input.store);
  const ownership = input.ownership;
  const skipped: CurationSkip[] = [];

  // Session ids expand to their bounded run lists; sessions with no runs skip whole.
  const targets = new Map<string, string>();
  for (const sessionId of input.sessionIds ?? []) {
    const runs = await pages(
      (cursor) => input.store.queryRuns({ sessionId, cursor, order: "asc", limit: pageSize, ...ownership }),
      maxPages,
    );
    for (const run of runs) targets.set(run.id, run.sessionId ?? sessionId);
    if (runs.length === 0) skipped.push({ id: sessionId, reason: "missing run" });
  }

  // Bare run ids need a session id for the resolver: one ownership-bounded scan.
  const bare = (input.runIds ?? []).filter((runId) => !targets.has(runId));
  if (bare.length > 0) {
    const wanted = new Set(bare);
    const scanned = await pages((cursor) => input.store.queryRuns({ cursor, order: "asc", limit: pageSize, ...ownership }), maxPages);
    for (const run of scanned) if (wanted.has(run.id)) targets.set(run.id, run.sessionId);
    for (const runId of bare) {
      if (!targets.has(runId)) skipped.push({ id: runId, reason: "missing run" });
    }
  }

  const redactor = resolveRedactor(input.redactor, input.secrets);
  const toItem = input.toItem ?? defaultCurateToItem;
  const ordered = [...targets.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  // One bounded feedback query per batch (the feedback store enforces its own page caps);
  // newest record wins per run. ponytail: single owner-scoped page — feedback beyond the
  // first page is ignored, which only omits `expected`; host toItem can fetch more.
  const feedbackByRun = new Map<string, RunFeedbackRecord>();
  if (input.store.feedback && ordered.length > 0) {
    try {
      const page = await input.store.feedback.query({ order: "desc", ...ownership, signal: input.signal });
      for (const record of page.items) {
        if (!feedbackByRun.has(record.runId)) feedbackByRun.set(record.runId, record);
      }
    } catch {
      // Feedback is optional enrichment: a scope-contract mismatch or store failure just
      // omits `expected` (never fabricated), same as a run without feedback records.
    }
  }

  const outcomes = await mapPool<[string, string], CurateOutcome<TInput, TExpected>>(
    ordered,
    concurrency,
    async ([runId, sessionId]): Promise<CurateOutcome<TInput, TExpected>> => {
      try {
        const trace = await resolver({
          ...ownership,
          sessionId,
          runId,
          limits: input.traceLimits,
          redactor,
          secrets: input.secrets,
          signal: input.signal,
        });
        const extracted = extractRunIO(trace);
        if (extracted.output === "") return { id: runId, reason: "empty output" } satisfies CurationSkip;
        const draft = toItem({
          run: trace.run,
          trace,
          input: extracted.input,
          output: extracted.output,
          feedback: feedbackByRun.get(runId),
        });
        if (!draft) return { id: runId, reason: "host filter" } satisfies CurationSkip;
        // Host-mapped fields too pass the redaction boundary (fail closed: redactor
        // throw → skip, never store raw).
        let redactedDraft: CuratedItemDraft<TInput, TExpected>;
        try {
          redactedDraft = (redactor ? redactor.redact(draft) : draft) as CuratedItemDraft<TInput, TExpected>;
        } catch {
          return { id: runId, reason: "redaction failed" } satisfies CurationSkip;
        }
        const item: DatasetItem<TInput, TExpected> = {
          id: redactedDraft.id ?? runId,
          input: redactedDraft.input,
          expected: redactedDraft.expected,
          metadata: redactedDraft.metadata,
        };
        const serialized = JSON.stringify(item) ?? "";
        if (Buffer.byteLength(serialized) > HARD_CURATION_ITEM_MAX_BYTES) {
          throw new EvalError(`curation item exceeds ${HARD_CURATION_ITEM_MAX_BYTES} bytes`, "ERR_PRISM_EVAL_CURATE");
        }
        return { item } as const;
      } catch (error) {
        if (error instanceof EvalError && error.code === "ERR_PRISM_EVAL_TRACE_OWNERSHIP") {
          return { id: runId, reason: "ownership mismatch" } satisfies CurationSkip;
        }
        if (error instanceof EvalError && error.code === "ERR_PRISM_EVAL_TRACE_NOT_FOUND") {
          return { id: runId, reason: "missing run" } satisfies CurationSkip;
        }
        throw error;
      }
    },
    input.signal,
  );

  const added: DatasetItem<TInput, TExpected>[] = [];
  for (const outcome of outcomes) {
    if ("item" in outcome) added.push(outcome.item);
    else skipped.push(outcome);
  }
  if (added.length === 0) return { dataset: input.dataset, version: input.dataset.version, added: 0, skipped };
  const version = nextVersion(input.dataset.version);
  const dataset = defineDataset<TInput, TExpected>({
    id: input.dataset.id,
    version,
    items: [...input.dataset.items, ...added],
  });
  return { dataset, version, added: added.length, skipped };
}
