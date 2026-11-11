/**
 * The concept pass (plan 207 Task 6): for each due subject or cluster, one bounded model call that returns a closed
 * set of cited edits, validated whole and written through the wiki's port. Nothing else writes a concept.
 *
 * Fail closed per item. An invalid answer, a trust hit that removes the subject, an abort or a worker limit writes
 * nothing for that item and leaves it due for the next trigger. A shape failure gets one repair call with a safe
 * reason code, the extractor's rule. A failed item never fails the pass.
 */
import type { ModelClient, SecretRedactor, ToolDefinition } from "@arnilo/prism";
import { type ConceptDoc, parseConceptBody } from "../ontology/codec.js";
import type { ConceptEdit, WikiOntologyPort, OntologyNoteView, OntologySubject } from "../ontology/port.js";
import type { WikiScopeLevel } from "../ontology/types.js";
import { measureWorkerJson, type ResolvedMemoryWorkerLimits, runMemoryWorkerLoop } from "@arnilo/prism-memory-system/core";
import {
  buildPrompt,
  CONSOLIDATE_CACHE_KEY,
  CONSOLIDATE_SYSTEM,
  MAX_PROMPT_NOTES,
  MAX_PROMPT_SUBJECTS,
  type PromptConcept,
  type PromptItem,
  type PromptNote,
  REPAIR_SHAPE,
  REPAIR_TRUNCATED,
} from "./prompt.js";
import { EDIT_CONCEPT_SCHEMA, EDIT_TOOL_NAME, type ParsedAnswer, parseAnswer, WikiAnswerError } from "./schema.js";
import { attemptKey, planScope, resolveTriggers, type WikiTrigger, type WorkItem, WRITE_SCOPES } from "./triggers.js";

export interface WikiPassConfig {
  readonly minNotes: number;
  readonly minCoReads: number;
  readonly maxSubjectsPerPass: number;
  readonly maxClaimsPerConcept: number;
  readonly triggers?: readonly WikiTrigger[];
  readonly limits: ResolvedMemoryWorkerLimits;
}

export interface WikiPassReport {
  /** Pass id: the start time. */
  readonly pass: string;
  readonly at: string;
  readonly trigger: "auto" | "manual";
  /** Scopes that were planned (a scope another pass held is not listed). */
  readonly scopes: readonly string[];
  /** Subjects and clusters that were due. */
  readonly due: number;
  /** Concepts written. */
  readonly subjects: number;
  readonly edits: number;
  /** Notes bound to a subject. */
  readonly binds: number;
  /** Items the curator answered with nothing. */
  readonly declined: number;
  /** Items that wrote nothing and stay due. */
  readonly left: number;
  readonly rejected: { readonly trust: number; readonly secret: number; readonly invalid: number };
  readonly modelCalls: number;
  readonly correctionCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  /** Safe reason codes of the items that failed, by count. */
  readonly failures: Readonly<Record<string, number>>;
}

export interface WikiPassInput {
  readonly port: WikiOntologyPort;
  /** Resolved only when an item needs a model call, so a quiet turn never touches the provider. */
  readonly client: () => ModelClient;
  readonly config: WikiPassConfig;
  readonly trigger: "auto" | "manual";
  /** In-process memory of attempts the curator answered with nothing. */
  readonly declined: Set<string>;
  /** One pass per scope at a time. A scope another pass holds is skipped, never queued. */
  readonly lease: WikiLease;
  readonly now?: Date;
  readonly redactor?: SecretRedactor;
  readonly sessionId?: string;
  readonly thinkingLevel?: string;
  readonly signal?: AbortSignal;
}

export interface WikiLease {
  enter(scope: string): boolean;
  exit(scope: string): void;
}

export function createWikiLease(): WikiLease {
  const running = new Set<string>();
  return {
    enter: (scope) => {
      if (running.has(scope)) return false;
      running.add(scope);
      return true;
    },
    exit: (scope) => {
      running.delete(scope);
    },
  };
}

interface Tally {
  due: number;
  subjects: number;
  edits: number;
  binds: number;
  declined: number;
  left: number;
  trust: number;
  secret: number;
  invalid: number;
  modelCalls: number;
  correctionCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  failures: Record<string, number>;
}

const slugLine = (subject: OntologySubject): string =>
  [subject.subject, subject.title, subject.aliases.join("; ")].filter((part) => part.length > 0).join(" | ");

function promptItem(
  item: { readonly id: string; readonly text: string; readonly cites: readonly string[]; readonly human?: true },
  stale: ReadonlySet<string>,
): PromptItem {
  // A person's item (marked `human`, or with no citation at all) is shown read-only; the port refuses an edit to it too.
  const readOnly = item.human === true || item.cites.length === 0;
  return {
    id: item.id,
    text: item.text,
    cites: item.cites,
    ...(stale.has(item.id) ? { stale: true } : {}),
    ...(readOnly ? { readOnly: true } : {}),
  };
}

async function readNotes(
  port: WikiOntologyPort,
  scope: WikiScopeLevel,
  ids: readonly string[],
  signal: AbortSignal | undefined,
): Promise<readonly OntologyNoteView[]> {
  const out: OntologyNoteView[] = [];
  for (let offset = 0; offset < ids.length; offset += 32) {
    out.push(...(await port.read(scope, ids.slice(offset, offset + 32), signal === undefined ? {} : { signal })));
  }
  return out;
}

const newestFirst = (a: OntologyNoteView, b: OntologyNoteView): number =>
  a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1;

/** What one call is built from and what its answer may name. */
interface Built {
  readonly prompt: ReturnType<typeof buildPrompt>;
  readonly context: Parameters<typeof parseAnswer>[1];
  readonly doc?: ConceptDoc;
}

async function build(item: WorkItem, input: WikiPassInput, subjects: readonly OntologySubject[]): Promise<Built | undefined> {
  const { port, config, signal } = input;
  const redact = (text: string): string => (input.redactor === undefined ? text : input.redactor.redact(text));
  const listing = subjects.map(slugLine).slice(0, MAX_PROMPT_SUBJECTS);
  const slugs = new Set(subjects.map((subject) => subject.subject));
  const claims = new Map<string, { cites: readonly string[]; readOnly: boolean }>();
  let concept: PromptConcept | null = null;
  let doc: ConceptDoc | undefined;
  let extra: readonly string[] = [];

  if (item.kind === "subject") {
    const row = subjects.find((subject) => subject.subject === item.subject);
    if (row === undefined) return undefined;
    const [view] = await readNotes(port, item.scope, [row.conceptId], signal);
    if (view === undefined) return undefined;
    doc = parseConceptBody(view.text, { allowUncited: true });
    const stale = new Set(view.stale ?? []);
    const bySubject = new Map(subjects.map((subject) => [subject.conceptId, subject.subject]));
    const items = (
      list: readonly { readonly id: string; readonly text: string; readonly cites: readonly string[]; readonly human?: true }[],
    ): PromptItem[] => list.map((entry) => promptItem({ ...entry, text: redact(entry.text) }, stale));
    const shownClaims = items(doc.claims);
    for (const claim of shownClaims) claims.set(claim.id, { cites: claim.cites, readOnly: claim.readOnly === true });
    concept = {
      subject: row.subject,
      title: redact(row.title),
      conceptType: row.conceptType,
      aliases: row.aliases,
      claims: shownClaims,
      questions: items(doc.questions),
      contradictions: items(doc.contradictions),
      relations: (view.links ?? []).flatMap((link) => {
        const target = bySubject.get(link.id);
        return target === undefined ? [] : [{ relation: link.relation ?? "related", subject: target }];
      }),
    };
    // Repair shows the evidence behind a stale claim, so the curator can restate it or retire it.
    extra = doc.claims.filter((claim) => stale.has(claim.id)).flatMap((claim) => claim.cites);
  }

  const wanted = [...new Set([...item.noteIds, ...extra])];
  const views = [...(await readNotes(port, item.scope, wanted, signal))].sort(newestFirst).slice(0, MAX_PROMPT_NOTES);
  if (item.kind === "cluster" && views.length < 2) return undefined;
  const notes: PromptNote[] = views.map((view) => ({
    id: view.id,
    kind: view.kind,
    scope: view.scope,
    createdAt: view.createdAt,
    ...(view.tRef === undefined ? {} : { tRef: view.tRef }),
    text: redact(view.text),
    ...(view.links === undefined || view.links.length === 0 ? {} : { links: view.links.map((link) => link.id) }),
  }));

  const shown = new Set<string>(notes.map((note) => note.id));
  for (const claim of claims.values()) for (const cite of claim.cites) shown.add(cite);
  for (const entry of [...(doc?.questions ?? []), ...(doc?.contradictions ?? [])]) for (const cite of entry.cites) shown.add(cite);

  return {
    prompt: buildPrompt({
      scope: item.scope,
      concept,
      claimBudget: { max: config.maxClaimsPerConcept, count: doc?.claims.length ?? 0 },
      notes,
      subjects: listing,
    }),
    context: {
      mode: item.kind,
      ...(item.subject === undefined ? {} : { subject: item.subject }),
      claims,
      notes: shown,
      subjects: slugs,
      claimCount: doc?.claims.length ?? 0,
      maxClaims: config.maxClaimsPerConcept,
    },
    ...(doc === undefined ? {} : { doc }),
  };
}

interface CallResult {
  readonly answer: ParsedAnswer;
  readonly calls: number;
  readonly corrections: number;
}

class CallFailure extends Error {
  constructor(
    readonly reasonCode: string,
    readonly calls: number,
    readonly corrections: number,
  ) {
    super(`concept call failed: ${reasonCode}`);
  }
}

/** Pass-through client that reports each turn's stop reason and token usage; the worker loop discards both. */
function observing(client: ModelClient, onDone: (stopReason: string | undefined, usage: unknown) => void): ModelClient {
  return {
    model: client.model,
    generate(request) {
      return (async function* observed() {
        for await (const event of client.generate(request)) {
          if (event.type === "done") onDone(event.stopReason, (event as { usage?: unknown }).usage);
          yield event;
        }
      })();
    },
  };
}

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** One curator call, with one repair call for a shape failure or a truncated answer. */
async function curate(built: Built, input: WikiPassInput, tally: Tally): Promise<CallResult> {
  const client = input.client();
  let calls = 0;
  let corrections = 0;
  let repair: { readonly reason: string; readonly instruction: string } | undefined;
  for (;;) {
    let recorded: ParsedAnswer | undefined;
    let failure: WikiAnswerError | undefined;
    let truncated = false;
    const watched = observing(client, (stopReason, usage) => {
      if (stopReason === "max_output_tokens") truncated = true;
      const used = (usage ?? {}) as Record<string, unknown>;
      tally.inputTokens += count(used.inputTokens);
      tally.outputTokens += count(used.outputTokens);
      tally.cacheReadTokens += count(used.cacheReadTokens);
    });
    const tool: ToolDefinition = {
      name: EDIT_TOOL_NAME,
      description: "Record the edits this evidence calls for, and nothing else.",
      parameters: EDIT_CONCEPT_SCHEMA,
      execute(args, toolContext) {
        try {
          if (recorded !== undefined) throw new WikiAnswerError("tool_call_shape", `${EDIT_TOOL_NAME} was called more than once`);
          recorded = parseAnswer(args, built.context);
        } catch (error) {
          failure = error instanceof WikiAnswerError ? error : new WikiAnswerError("answer_shape", "invalid tool arguments");
          throw failure;
        }
        return { toolCallId: toolContext.toolCallId, name: EDIT_TOOL_NAME, value: { accepted: true } };
      },
    };
    const prompt = repair === undefined ? built.prompt : { ...built.prompt, repair };
    measureWorkerJson(prompt, input.config.limits.maxMessageBytes, "wiki concept input");
    calls += 1;
    tally.modelCalls += 1;
    try {
      await runMemoryWorkerLoop({
        ...input.config.limits,
        maxTurns: 1,
        maxToolCalls: 1,
        maxToolCallsPerTurn: 1,
        client: watched,
        system: CONSOLIDATE_SYSTEM,
        prompt: JSON.stringify(prompt),
        tools: [tool],
        providerOptions: { cacheKey: CONSOLIDATE_CACHE_KEY },
        ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason ?? error;
      const classified: WikiAnswerError | undefined = failure ?? (error instanceof WikiAnswerError ? error : undefined);
      if (classified?.repairable && corrections === 0) {
        repair = { reason: classified.reasonCode, instruction: REPAIR_SHAPE };
        corrections += 1;
        tally.correctionCalls += 1;
        continue;
      }
      throw new CallFailure(classified?.reasonCode ?? (truncated ? "output_truncated" : "model_call_failed"), calls, corrections);
    }
    if (recorded === undefined) {
      const reason = truncated ? "output_truncated" : "tool_call_missing";
      if (corrections === 0) {
        repair = { reason, instruction: truncated ? REPAIR_TRUNCATED : REPAIR_SHAPE };
        corrections += 1;
        tally.correctionCalls += 1;
        continue;
      }
      throw new CallFailure(reason, calls, corrections);
    }
    return { answer: recorded, calls, corrections };
  }
}

/** Drop the edits whose text the trust scan or the redactor refuses; a refused `create_subject` drops the item. */
function screen(
  answer: ParsedAnswer,
  input: WikiPassInput,
  tally: Tally,
): {
  readonly edits: readonly ConceptEdit[];
  readonly binds: readonly { readonly noteId: string; readonly subject: string }[];
  readonly dropped: boolean;
} {
  const edits: ConceptEdit[] = [];
  const binds: { noteId: string; subject: string }[] = [];
  for (const parsed of answer.edits) {
    const joined = parsed.texts.join("\n");
    if (joined.length > 0) {
      if (input.port.screen(joined) !== undefined) {
        tally.trust += 1;
        if (parsed.op === "create_subject") return { edits: [], binds: [], dropped: true };
        continue;
      }
      if (input.redactor !== undefined && input.redactor.redact(joined) !== joined) {
        tally.secret += 1;
        if (parsed.op === "create_subject") return { edits: [], binds: [], dropped: true };
        continue;
      }
    }
    if (parsed.edit.op === "bind") binds.push({ noteId: parsed.edit.noteId, subject: parsed.edit.subject });
    else edits.push(parsed.edit);
  }
  return { edits, binds, dropped: false };
}

async function runItem(item: WorkItem, input: WikiPassInput, subjects: readonly OntologySubject[], tally: Tally): Promise<void> {
  const fail = (code: string): void => {
    tally.left += 1;
    tally.failures[code] = (tally.failures[code] ?? 0) + 1;
  };
  const built = await build(item, input, subjects);
  if (built === undefined) return fail("not_found");
  let result: CallResult;
  try {
    result = await curate(built, input, tally);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (error instanceof CallFailure) return fail(error.reasonCode);
    return fail("model_call_failed");
  }
  const screened = screen(result.answer, input, tally);
  if (screened.dropped) return fail("refused");
  if (screened.edits.length === 0 && screened.binds.length === 0) {
    // Nothing to add: remember the attempt, and clear the subject's evidence flag so it is not offered again.
    input.declined.add(attemptKey(item));
    tally.declined += 1;
    if (item.kind === "subject" && item.subject !== undefined && !item.more) {
      await input.port.settle(item.scope, item.subject, input.signal === undefined ? {} : { signal: input.signal });
    }
    return;
  }
  try {
    if (screened.edits.length > 0) {
      const written = await input.port.applyConceptEdits(item.scope, screened.edits, {
        generatedBy: "consolidation",
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      tally.subjects += written.subjects.length;
      tally.edits += written.edits;
    }
    const target = result.answer.subject;
    for (const bind of screened.binds) {
      if (await input.port.bind(item.scope, bind.noteId, bind.subject, input.signal === undefined ? {} : { signal: input.signal }))
        tally.binds += 1;
    }
    // Binding flags the concept for evidence; the pass has just consumed it, unless more notes were due than it showed.
    if (target !== undefined && !item.more) {
      await input.port.settle(item.scope, target, input.signal === undefined ? {} : { signal: input.signal });
    }
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason ?? error;
    // The port refused the batch whole (unknown subject, a citation it cannot read, an empty new concept, a text
    // it will not store). Nothing was written for this item, and it stays due.
    tally.invalid += 1;
    fail("rejected");
  }
}

/** Run one pass over the readable write scopes. Never throws for a failed item; an abort propagates. */
export async function runWikiPass(input: WikiPassInput): Promise<WikiPassReport> {
  const at = (input.now ?? new Date()).toISOString();
  const tally: Tally = {
    due: 0,
    subjects: 0,
    edits: 0,
    binds: 0,
    declined: 0,
    left: 0,
    trust: 0,
    secret: 0,
    invalid: 0,
    modelCalls: 0,
    correctionCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    failures: {},
  };
  const scopes: string[] = [];
  const triggers = resolveTriggers(input.config.triggers);
  // Catch up with long-term memory first: a forgotten citation is cascaded before anything is planned on it.
  await input.port.refresh(input.signal === undefined ? {} : { signal: input.signal });
  const readable = new Set(input.port.scopes());
  let budget = input.config.maxSubjectsPerPass;
  for (const scope of WRITE_SCOPES) {
    if (!readable.has(scope) || budget <= 0) continue;
    if (!input.lease.enter(scope)) continue;
    try {
      input.signal?.throwIfAborted();
      scopes.push(scope);
      const planned = await planScope(input.port, scope, {
        triggers,
        minNotes: input.config.minNotes,
        minCoReads: input.config.minCoReads,
        force: input.trigger === "manual",
        declined: input.declined,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      tally.due += planned.length;
      if (planned.length === 0) continue;
      const subjects = await input.port.subjects(scope, input.signal === undefined ? {} : { signal: input.signal });
      for (const item of planned.slice(0, budget)) {
        input.signal?.throwIfAborted();
        budget -= 1;
        await runItem(item, input, subjects, tally);
      }
    } finally {
      input.lease.exit(scope);
    }
  }
  return {
    pass: at,
    at,
    trigger: input.trigger,
    scopes,
    due: tally.due,
    subjects: tally.subjects,
    edits: tally.edits,
    binds: tally.binds,
    declined: tally.declined,
    left: tally.left,
    rejected: { trust: tally.trust, secret: tally.secret, invalid: tally.invalid },
    modelCalls: tally.modelCalls,
    correctionCalls: tally.correctionCalls,
    inputTokens: tally.inputTokens,
    outputTokens: tally.outputTokens,
    cacheReadTokens: tally.cacheReadTokens,
    failures: tally.failures,
  };
}
