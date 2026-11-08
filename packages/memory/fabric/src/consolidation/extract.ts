/**
 * The consolidation extractor (plan 188.3 Task 2): one bounded model call per pass that turns the
 * gathered candidates into atomic, typed, scoped notes.
 *
 * Fail closed. A malformed answer — invalid shape, an unknown kind or scope, an evidence or
 * contradiction id that was not shown, an oversized item — throws `ConsolidationExtractionError`
 * and the caller writes nothing and keeps its cursor. Only the per-item trust scan and secret
 * redactor reject a single note and are counted; everything else rejects the whole answer.
 */
import type { ModelClient, SecretRedactor, ToolDefinition } from "@arnilo/prism";
import { redactJson } from "@arnilo/prism-memory-core";
import { measureWorkerJson, type ResolvedMemoryWorkerLimits, runMemoryWorkerLoop } from "@arnilo/prism-memory-core";
import { scanScopedMemoryContent } from "@arnilo/prism-memory-core";
import { type MemoryNoteScope, validateAppliesTo, validateNoteKey } from "../types.js";
import type { ConsolidationCandidate } from "./gather.js";
import {
  buildConsolidationExtractPrompt,
  CONSOLIDATION_EXTRACT_SYSTEM,
  CONSOLIDATION_EXTRACT_SYSTEM_PROJECT,
  type ConsolidationExistingNote,
  type ConsolidationSegment,
  candidateIds,
  consolidationExtractSchema,
  EXTRACT_TOOL_NAME,
  EXTRACTED_NOTE_KEYS,
  type ExtractedNoteKind,
  isExtractedNoteKind,
  MAX_EPISODE_CHARS,
  MAX_EXISTING_NOTES_PER_SCOPE,
  MAX_EXTRACTED_ALIASES,
  MAX_EXTRACTED_EVIDENCE,
  MAX_EXTRACTED_KEYWORDS,
  MAX_EXTRACTED_NOTES,
  MAX_EXTRACTED_TEXT_CHARS,
} from "./prompts.js";

export type ExtractedNoteScope = Exclude<MemoryNoteScope, "agent">;

export interface ExtractedNote {
  readonly text: string;
  readonly kind: ExtractedNoteKind;
  /** Never `agent`: the extractor's agent scope is downgraded to `project`. */
  readonly scope: ExtractedNoteScope;
  readonly appliesTo?: readonly string[];
  readonly key?: string;
  /** When the fact or event happened; copied from the evidence when it carries a time. */
  readonly tRef?: string;
  readonly keywords: readonly string[];
  readonly aliases: readonly string[];
  /** Ids of the shown candidates (`c1`, `c2`, ...) that support the note. */
  readonly evidence: readonly string[];
  readonly explicit: boolean;
  readonly correction: boolean;
  readonly generality: number;
  readonly ephemerality: number;
  readonly derivable: boolean;
  /** A shown existing note this one cannot be reconciled with. */
  readonly contradicts?: string;
  /** The segment an episode summarises. */
  readonly segment?: string;
}

export interface ConsolidationExtraction {
  readonly notes: readonly ExtractedNote[];
  /** The existing notes the extractor was shown, for duplicate and contradiction bookkeeping. Never `agent`-downgraded. */
  readonly existing: readonly ConsolidationExistingNote[];
  readonly rejected: { readonly trust: number; readonly secret: number };
  /** Actual extractor model calls: 1 for a valid pass, 2 only after one bounded repair. */
  readonly modelCalls: number;
  /** The subset of `modelCalls` spent repairing a malformed answer. */
  readonly correctionCalls: number;
  /** Calls that stopped on the output limit (`max_output_tokens`), repaired or not. */
  readonly outputLimited: number;
}

/** Safe validation reason codes; never raw model text. */
export type ConsolidationExtractionReason =
  | "answer_shape"
  | "notes_shape"
  | "note_shape"
  | "note_kind"
  | "note_scope"
  | "path_scope"
  | "applies_to_shape"
  | "note_key"
  | "note_tref"
  | "evidence_shape"
  | "evidence_not_shown"
  | "contradicts_shape"
  | "contradicts_not_shown"
  | "episode_shape"
  | "segment_shape"
  | "segment_not_shown"
  | "segment_duplicate"
  | "tool_call_missing"
  | "tool_call_shape"
  | "output_truncated"
  | "model_call_failed";

/** The closed set, for a fail-closed read of a persisted tally. */
export const EXTRACTION_REASONS: ReadonlySet<ConsolidationExtractionReason> = new Set([
  "answer_shape",
  "notes_shape",
  "note_shape",
  "note_kind",
  "note_scope",
  "path_scope",
  "applies_to_shape",
  "note_key",
  "note_tref",
  "evidence_shape",
  "evidence_not_shown",
  "contradicts_shape",
  "contradicts_not_shown",
  "episode_shape",
  "segment_shape",
  "segment_not_shown",
  "segment_duplicate",
  "tool_call_missing",
  "tool_call_shape",
  "output_truncated",
  "model_call_failed",
]);

/** Shape-only failures may be corrected once; provenance, safety, abort and limit failures never are. */
const REPAIRABLE_REASONS: ReadonlySet<ConsolidationExtractionReason> = new Set([
  "answer_shape",
  "notes_shape",
  "note_shape",
  "note_kind",
  "note_scope",
  "path_scope",
  "applies_to_shape",
  "note_key",
  "note_tref",
  "evidence_shape",
  "contradicts_shape",
  "episode_shape",
  "segment_shape",
  "segment_duplicate",
  "tool_call_missing",
  "tool_call_shape",
  // A truncated answer is a shape failure the model can fix once by writing fewer, shorter notes.
  "output_truncated",
]);

export class ConsolidationExtractionError extends Error {
  readonly reason: string;
  readonly reasonCode: ConsolidationExtractionReason;
  readonly repairable: boolean;
  readonly modelCalls: number;
  readonly correctionCalls: number;
  constructor(
    reason: string,
    options: {
      readonly reasonCode?: ConsolidationExtractionReason;
      readonly modelCalls?: number;
      readonly correctionCalls?: number;
    } = {},
  ) {
    super(`consolidation extraction failed: ${reason}`);
    this.name = "ConsolidationExtractionError";
    this.reason = reason;
    this.reasonCode = options.reasonCode ?? "model_call_failed";
    this.repairable = REPAIRABLE_REASONS.has(this.reasonCode);
    this.modelCalls = options.modelCalls ?? 0;
    this.correctionCalls = options.correctionCalls ?? 0;
  }
}

export interface ExtractConsolidationNotesInput {
  /** Resolved by the caller only when a pass runs, exactly as the decider's client is. */
  readonly client: ModelClient;
  readonly candidates: readonly ConsolidationCandidate[];
  readonly segments?: readonly ConsolidationSegment[];
  /**
   * Lexical recall of active notes for one scope. Called four times at most, with the candidate text
   * as the query; the fabric's own recall supplies it, so this module never touches a store.
   */
  readonly recallExisting?: (
    query: string,
    scope: MemoryNoteScope,
    limit: number,
  ) => Promise<readonly ConsolidationExistingNote[]> | readonly ConsolidationExistingNote[];
  readonly limits: ResolvedMemoryWorkerLimits;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly sessionId?: string;
  /** The project scope with a root is active, so the repository and derivability rules apply. */
  readonly repositoryRules?: boolean;
  /** Default 48, capped by `MAX_EXTRACTED_NOTES`. */
  readonly maxNotes?: number;
  /** The extractor's reasoning effort, passed through to the worker loop. */
  readonly thinkingLevel?: string;
  readonly signal?: AbortSignal;
}

const RECALL_QUERY_CHARS = 2_000;
const EXTRACT_CACHE_KEY = "prism-fabric-extract";
const NOTE_SCOPES: readonly MemoryNoteScope[] = ["user", "project", "agent", "path"];

/**
 * One extractor call over the gathered candidates. Returns typed notes, already downgraded and
 * filtered, plus the existing notes it was shown so the caller can resolve contradictions.
 */
export async function extractConsolidationNotes(input: ExtractConsolidationNotesInput): Promise<ConsolidationExtraction> {
  const maxNotes = Math.min(input.maxNotes ?? MAX_EXTRACTED_NOTES, MAX_EXTRACTED_NOTES);
  if (!Number.isSafeInteger(maxNotes) || maxNotes < 0) throw new RangeError("maxNotes must be a non-negative safe integer");
  const shown = candidateIds(input.candidates);
  const segments = input.segments ?? [];
  const existing = await loadExisting(input, maxNotes);
  const payload = redactJson(
    buildConsolidationExtractPrompt({
      candidates: input.candidates,
      existing,
      segments,
      maxNotes,
    }),
    input.redactor,
  );
  measureWorkerJson(payload, input.limits.maxMessageBytes, "fabric extractor input");
  const context: ParseContext = {
    candidateIds: new Set(shown),
    existingIds: new Set(existing.map((note) => note.id)),
    segmentIds: new Set(segments.map((segment) => segment.id)),
    maxNotes,
  };
  const parameters = consolidationExtractSchema({ maxNotes });

  let calls = 0;
  let correctionCalls = 0;
  let outputLimited = 0;
  let repair: ConsolidationExtractionError | undefined;
  let recorded: readonly ExtractedNote[] | undefined;
  for (;;) {
    recorded = undefined;
    // The worker loop drops `done` events, so the stop reason is captured on the way through.
    let truncated = false;
    const client = observingStops(input.client, (stopReason) => {
      if (stopReason === "max_output_tokens") truncated = true;
    });
    let failure: ConsolidationExtractionError | undefined;
    const tool: ToolDefinition = {
      name: EXTRACT_TOOL_NAME,
      description: "Record the durable notes this session taught, and nothing else.",
      parameters,
      execute(args, toolContext) {
        try {
          if (recorded !== undefined) fail("tool_call_shape", "record_notes was called more than once");
          recorded = parseExtractedNotes(args, context);
        } catch (error) {
          const classified =
            error instanceof ConsolidationExtractionError ? error : new ConsolidationExtractionError("invalid tool arguments");
          failure = classified;
          throw classified;
        }
        return { toolCallId: toolContext.toolCallId, name: EXTRACT_TOOL_NAME, value: { accepted: true } };
      },
    };
    const prompt =
      repair === undefined
        ? payload
        : {
            ...payload,
            repair: {
              reason: repair.reasonCode,
              instruction:
                repair.reasonCode === "output_truncated"
                  ? `The previous answer hit the output limit before ${EXTRACT_TOOL_NAME} was recorded. Call it again with fewer, shorter notes over the same shown evidence: one sentence per note, merge related items. Do not cite new ids or widen scope.`
                  : "The previous record_notes answer was rejected for shape only. Call it again with the same shown evidence and intent. Do not cite new ids or widen scope.",
            },
          };
    measureWorkerJson(prompt, input.limits.maxMessageBytes, "fabric extractor input");
    calls += 1;
    try {
      await runMemoryWorkerLoop({
        ...input.limits,
        maxTurns: 1,
        maxToolCalls: 1,
        maxToolCallsPerTurn: 1,
        client,
        system: input.repositoryRules === true ? CONSOLIDATION_EXTRACT_SYSTEM_PROJECT : CONSOLIDATION_EXTRACT_SYSTEM,
        prompt: JSON.stringify(prompt),
        tools: [tool],
        providerOptions: { cacheKey: `${EXTRACT_CACHE_KEY}:${input.repositoryRules === true ? "project" : "default"}` },
        ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
        ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason ?? error;
      // A truncated stream may fail before `done`, so the captured stop reason is one signal of many.
      if (truncated) outputLimited += 1;
      const classified = failure ?? (error instanceof ConsolidationExtractionError ? error : undefined);
      if (classified?.repairable && correctionCalls === 0) {
        repair = classified;
        correctionCalls += 1;
        continue;
      }
      if (classified !== undefined)
        throw new ConsolidationExtractionError(classified.reason, {
          reasonCode: classified.reasonCode,
          modelCalls: calls,
          correctionCalls,
        });
      throw new ConsolidationExtractionError(error instanceof Error ? error.message : "extractor call failed", {
        reasonCode: "model_call_failed",
        modelCalls: calls,
        correctionCalls,
      });
    }
    if (truncated) outputLimited += 1;
    if (recorded === undefined) {
      // An answer that stopped at the output limit without a usable record_notes call is repairable
      // once with fewer, shorter notes; a second one fails the pass with that code.
      const error = truncated
        ? new ConsolidationExtractionError("the extractor stopped on the output limit", { reasonCode: "output_truncated" })
        : new ConsolidationExtractionError(`missing ${EXTRACT_TOOL_NAME} call`, { reasonCode: "tool_call_missing" });
      if (correctionCalls === 0) {
        repair = error;
        correctionCalls += 1;
        continue;
      }
      throw new ConsolidationExtractionError(error.reason, { reasonCode: error.reasonCode, modelCalls: calls, correctionCalls });
    }
    break;
  }

  if (recorded === undefined) throw new ConsolidationExtractionError(`missing ${EXTRACT_TOOL_NAME} call`);
  const notes: ExtractedNote[] = [];
  let trust = 0;
  let secret = 0;
  for (const note of recorded as readonly ExtractedNote[]) {
    const scanned = [note.text, ...note.keywords, ...note.aliases].join("\n");
    if (!scanScopedMemoryContent(scanned).ok) {
      trust += 1;
      continue;
    }
    if (input.redactor !== undefined && input.redactor.redact(scanned) !== scanned) {
      secret += 1;
      continue;
    }
    notes.push(note);
  }
  return { notes, existing, rejected: { trust, secret }, modelCalls: calls, correctionCalls, outputLimited };
}

/** Pass-through client that reports each turn's stop reason; the worker loop itself discards it. */
function observingStops(client: ModelClient, onDone: (stopReason: string | undefined) => void): ModelClient {
  return {
    model: client.model,
    generate(request) {
      return (async function* observed() {
        for await (const event of client.generate(request)) {
          if (event.type === "done") onDone(event.stopReason);
          yield event;
        }
      })();
    },
  };
}

/** Up to 12 active notes per scope, by the caller's lexical recall over the candidate text. */
async function loadExisting(input: ExtractConsolidationNotesInput, maxNotes: number): Promise<readonly ConsolidationExistingNote[]> {
  if (!input.recallExisting || maxNotes === 0) return [];
  const query = input.candidates
    .map((candidate) => candidate.text)
    .join("\n")
    .slice(0, RECALL_QUERY_CHARS);
  const seen = new Set<string>();
  const existing: ConsolidationExistingNote[] = [];
  for (const scope of NOTE_SCOPES) {
    const recalled = await input.recallExisting(query, scope, MAX_EXISTING_NOTES_PER_SCOPE);
    for (const note of recalled.slice(0, MAX_EXISTING_NOTES_PER_SCOPE)) {
      if (typeof note?.id !== "string" || note.id.length === 0 || typeof note.text !== "string") continue;
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      existing.push({
        id: note.id,
        text: note.text,
        scope: note.scope,
        ...(note.kind === undefined ? {} : { kind: note.kind }),
        ...(note.key === undefined ? {} : { key: note.key }),
        ...(note.tRef === undefined ? {} : { tRef: note.tRef }),
      });
    }
  }
  return existing;
}

interface ParseContext {
  readonly candidateIds: ReadonlySet<string>;
  readonly existingIds: ReadonlySet<string>;
  readonly segmentIds: ReadonlySet<string>;
  readonly maxNotes: number;
}

function fail(reasonCode: ConsolidationExtractionReason, reason: string): never {
  throw new ConsolidationExtractionError(reason, { reasonCode });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringList(value: unknown, max: number, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > max) fail("note_shape", `${label} must be an array of at most ${max}`);
  return value.map((item) => {
    if (typeof item !== "string" || item.length === 0 || item.length > 48) fail("note_shape", `${label} must hold 1-48 character strings`);
    return item;
  });
}

function unit(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    fail("note_shape", `${label} must be a number in [0,1]`);
  return value;
}

function flag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail("note_shape", `${label} must be a boolean`);
  return value;
}

/** Validate the answer against the schema constants; the returned notes are safe to store. */
function parseExtractedNotes(raw: unknown, context: ParseContext): readonly ExtractedNote[] {
  const answer = record(raw);
  if (!answer) fail("answer_shape", "answer must be an object");
  const keys = Object.keys(answer!);
  if (keys.some((key) => key !== "notes")) fail("answer_shape", "answer has unexpected keys");
  const items = answer!.notes;
  if (!Array.isArray(items)) fail("notes_shape", "notes must be an array");
  if (items.length > context.maxNotes) fail("notes_shape", `notes exceeds ${context.maxNotes} items`);

  const notes: ExtractedNote[] = [];
  const episodeSegments = new Set<string>();
  for (const item of items as unknown[]) {
    const note = record(item);
    if (!note) fail("note_shape", "each note must be an object");
    if (Object.keys(note!).some((key) => !EXTRACTED_NOTE_KEYS.includes(key))) fail("note_shape", "note has unexpected keys");

    const text = note!.text;
    if (typeof text !== "string" || text.trim().length === 0) fail("note_shape", "note text must be a non-empty string");
    if (text.length > MAX_EXTRACTED_TEXT_CHARS) fail("note_shape", `note text exceeds ${MAX_EXTRACTED_TEXT_CHARS} characters`);

    const kind = note!.kind;
    if (!isExtractedNoteKind(kind)) fail("note_kind", "note kind is not one of the extractor kinds");

    const rawScope = note!.scope;
    if (rawScope !== "user" && rawScope !== "agent" && rawScope !== "project" && rawScope !== "path")
      fail("note_scope", "note scope is invalid");
    const scope: ExtractedNoteScope = rawScope === "agent" ? "project" : rawScope;

    let appliesTo: readonly string[] | undefined;
    if (scope === "path") {
      try {
        appliesTo = validateAppliesTo(note!.applies_to);
      } catch {
        fail("path_scope", "path-scoped note needs 1-8 valid applies_to globs");
      }
    } else if (note!.applies_to !== undefined) {
      try {
        appliesTo = validateAppliesTo(note!.applies_to);
      } catch {
        fail("applies_to_shape", "applies_to is invalid");
      }
    }

    let key: string | undefined;
    if (note!.key !== undefined) {
      try {
        key = validateNoteKey(note!.key);
      } catch {
        fail("note_key", "note key is invalid");
      }
    }

    let tRef: string | undefined;
    if (note!.tRef !== undefined) {
      if (typeof note!.tRef !== "string" || !Number.isFinite(Date.parse(note!.tRef)) || !/^\d{4}-\d{2}-\d{2}T/.test(note!.tRef))
        fail("note_tref", "tRef must be an ISO 8601 timestamp");
      tRef = note!.tRef;
    }

    const evidence = stringList(note!.evidence, MAX_EXTRACTED_EVIDENCE, "evidence");
    if (evidence.length === 0) fail("evidence_shape", "evidence must name at least one shown candidate");
    for (const id of evidence) if (!context.candidateIds.has(id)) fail("evidence_not_shown", "evidence names an id that was not shown");

    let contradicts: string | undefined;
    if (note!.contradicts !== undefined) {
      if (typeof note!.contradicts !== "string") fail("contradicts_shape", "contradicts must be a shown note id");
      if (!context.existingIds.has(note!.contradicts)) fail("contradicts_not_shown", "contradicts names a note id that was not shown");
      contradicts = note!.contradicts;
    }

    let segment: string | undefined;
    if (kind === "episode") {
      if (text.length > MAX_EPISODE_CHARS) fail("episode_shape", `episode text exceeds ${MAX_EPISODE_CHARS} characters`);
      if (typeof note!.segment !== "string") fail("segment_shape", "episode needs a segment id");
      if (!context.segmentIds.has(note!.segment)) fail("segment_not_shown", "episode needs a shown segment id");
      if (episodeSegments.has(note!.segment)) fail("segment_duplicate", "more than one episode for the same segment");
      episodeSegments.add(note!.segment);
      segment = note!.segment;
    }

    notes.push({
      text: text.trim(),
      kind,
      scope,
      ...(appliesTo === undefined ? {} : { appliesTo }),
      ...(key === undefined ? {} : { key }),
      ...(tRef === undefined ? {} : { tRef }),
      keywords: stringList(note!.keywords, MAX_EXTRACTED_KEYWORDS, "keywords"),
      aliases: stringList(note!.aliases, MAX_EXTRACTED_ALIASES, "aliases"),
      evidence,
      explicit: flag(note!.explicit, "explicit"),
      correction: flag(note!.correction, "correction"),
      generality: unit(note!.generality, "generality"),
      ephemerality: unit(note!.ephemerality, "ephemerality"),
      derivable: flag(note!.derivable, "derivable"),
      ...(contradicts === undefined ? {} : { contradicts }),
      ...(segment === undefined ? {} : { segment }),
    });
  }
  return notes;
}
