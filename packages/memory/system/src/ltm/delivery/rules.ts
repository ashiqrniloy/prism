/**
 * Standing rules (plan 188.5 Task 1 as the pinned core, plan 202 Task 11 as coding decisions, plan 209
 * Task 3 as one module): a small always-present set of verified rules per scope, rendered into the prompt
 * prefix, written to an editable `rules.md`, and captured from user turns behind a confirmation.
 *
 * - **Block.** Verified, active, unflagged notes of the rule kinds, human-written rules first, then pinned,
 *   decisions, and storage strength S. Rebuilt only when a note it could show changes, so a quiet turn sends
 *   byte-identical bytes and the provider cache survives. One metadata scan per scope, one bounded `get`.
 *   Path-scoped rules are not in the block; they load as cues when a touched path matches.
 * - **Capture.** Lexical: a user turn with a lasting-rule cue becomes a `proposed` note, never `active`.
 *   Activation is a person's answer through `host.ui`. No model call. Tool output is never an input.
 * - **`rules.md`.** With the markdown store each scope's rules are written to an editable file. A person's
 *   edit is reconciled into notes at the next session start: an added line is a pinned human rule, a deleted
 *   line retires its note, a changed line supersedes it. A line that trips the trust scan is refused.
 */
import { createHash } from "node:crypto";
import { type HostUi, resolveRedactor, type SecretRedactor } from "@arnilo/prism";
import {
  type Memory,
  MemoryValidationError,
  type MemoryVectorMetadataPage,
  type MemoryVectorMetadataRow,
  redactJson,
  type VectorScanMetadataQuery,
} from "@arnilo/prism-memory-core";
import { memoryWriteVersion } from "../directory.js";
import { isActiveNote, normalizeNoteStatus, type StorageWeights, storageStrength } from "../lifecycle/index.js";
import { scanScopedMemoryContent } from "@arnilo/prism-memory-core";
import {
  isMemoryNoteValidAt,
  type MemoryFabricRememberInput,
  type MemoryFabricWriteOptions,
  type MemoryNoteKind,
  type MemoryNoteMetadata,
  parseMemoryNoteMetadata,
} from "../types.js";

/** Scope levels the rules draw from, in the order the block lists them. */
export type FabricRulesScope = "user" | "project";

/** `confirm` captures rules from user turns behind one `host.ui` confirmation; `off` never captures. */
export type FabricRulesCapture = "off" | "confirm";

export interface MemoryFabricRulesConfig {
  /**
   * Ceiling on the rendered block. Default 600, or 2,000 when `capture` is `confirm`; at most
   * {@link HARD_RULES_TOKENS}.
   */
  readonly maxTokens?: number;
  /** Scopes to include. Default both; `user` always renders first. */
  readonly scopes?: readonly FabricRulesScope[];
  /** Kinds eligible as rules. Default fact, preference, procedure and decision. */
  readonly kinds?: readonly MemoryNoteKind[];
  /** Capture rules from user turns. Default `off`; the `coding` preset sets `confirm`. */
  readonly capture?: FabricRulesCapture;
}

export interface ResolvedFabricRulesOptions {
  readonly maxTokens: number;
  readonly scopes: readonly FabricRulesScope[];
  readonly kinds: readonly MemoryNoteKind[];
  readonly capture: FabricRulesCapture;
}

export const HARD_RULES_TOKENS = 3_000;
export const DEFAULT_RULES_TOKENS = 600;
/** The budget when capture is on: a captured rule set earns the larger always-loaded block. */
export const DEFAULT_CAPTURE_RULES_TOKENS = 2_000;
export const DEFAULT_RULES_KINDS: readonly MemoryNoteKind[] = Object.freeze(["fact", "preference", "procedure", "decision"]);
export const DEFAULT_RULES_OPTIONS: ResolvedFabricRulesOptions = Object.freeze({
  maxTokens: DEFAULT_RULES_TOKENS,
  scopes: Object.freeze(["user", "project"]) as readonly FabricRulesScope[],
  kinds: DEFAULT_RULES_KINDS,
  capture: "off",
});

/** One `scanMetadata` page per scope: the rules are a top slice, not a full census. */
const RULES_SCAN_PAGE = 500;
const RULES_GET_BATCH = 100;
/** Path-scoped rules listed in `rules.md` per scope (they are not in the block). */
const MAX_FILE_PATH_RULES = 50;
/** Reserved for the "k more" line when the block overflows. */
const OVERFLOW_LINE_TOKENS = 16;
const RULES_KIND_NAMES: ReadonlySet<string> = new Set<MemoryNoteKind>(["preference", "fact", "procedure", "decision"]);

export function resolveFabricRulesOptions(
  input: boolean | MemoryFabricRulesConfig | undefined,
  defaultOn: boolean,
): false | ResolvedFabricRulesOptions {
  if (input === false || (input === undefined && !defaultOn)) return false;
  const config = input === true || input === undefined ? {} : input;
  const capture = config.capture ?? DEFAULT_RULES_OPTIONS.capture;
  if (capture !== "off" && capture !== "confirm") throw new MemoryValidationError('rules.capture must be "off" or "confirm"');
  const maxTokens = config.maxTokens ?? (capture === "confirm" ? DEFAULT_CAPTURE_RULES_TOKENS : DEFAULT_RULES_TOKENS);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > HARD_RULES_TOKENS) {
    throw new MemoryValidationError(`rules.maxTokens must be an integer in [1,${HARD_RULES_TOKENS}]`);
  }
  const requested = config.scopes ?? DEFAULT_RULES_OPTIONS.scopes;
  if (!Array.isArray(requested) || requested.length === 0 || new Set(requested).size !== requested.length) {
    throw new MemoryValidationError('rules.scopes must be a non-empty list of "user" and "project"');
  }
  for (const level of requested) {
    if (level !== "user" && level !== "project")
      throw new MemoryValidationError('rules.scopes must be a non-empty list of "user" and "project"');
  }
  const kinds = config.kinds ?? DEFAULT_RULES_KINDS;
  if (!Array.isArray(kinds) || kinds.length === 0 || new Set(kinds).size !== kinds.length) {
    throw new MemoryValidationError("rules.kinds must be a non-empty list of durable note kinds");
  }
  for (const kind of kinds) {
    if (!RULES_KIND_NAMES.has(kind)) throw new MemoryValidationError("rules.kinds must be a non-empty list of durable note kinds");
  }
  return { maxTokens, scopes: DEFAULT_RULES_OPTIONS.scopes.filter((level) => requested.includes(level)), kinds: [...kinds], capture };
}

/** One active scope the rules read, and the memory that holds it. */
export interface FabricRulesScopeBinding {
  readonly level: FabricRulesScope;
  readonly memory: Memory;
}

type RulesScopeId = { readonly tenantId: string; readonly resourceId: string };

export interface CreateFabricRulesOptions {
  readonly scopes: readonly FabricRulesScopeBinding[];
  readonly options: ResolvedFabricRulesOptions;
  /** The store's metadata scan; the rules need no text from a listing, only ids and metadata. */
  readonly scanMetadata: (query: VectorScanMetadataQuery) => Promise<MemoryVectorMetadataPage>;
  readonly storageWeights?: StorageWeights;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  /**
   * Write a scope's `rules.md` (the markdown store has one; the others have no file layout). Resolves
   * `false` when a person's unreconciled edit was kept instead. A failure is reported once and never
   * fails the turn.
   */
  readonly writeFile?: (scope: RulesScopeId, content: string, options?: { readonly replaceEdited?: boolean }) => Promise<boolean>;
  readonly notify?: (message: string) => void;
}

/** The rendered block, without the context-block envelope the caller adds. */
export interface FabricRulesBlock {
  readonly content: string;
  readonly tokens: number;
  /** The notes the block shows, so later tiers can deduplicate against it. */
  readonly itemIds: readonly string[];
}

/** What the last computation left out; human rules that did not fit are a `memory:status` warning. */
export interface FabricRulesOverflow {
  readonly shown: number;
  readonly more: number;
  readonly humanDropped: number;
}

export interface FabricRules {
  /** The cached block; recomputed only after a write bumped a scope's version. */
  block(signal?: AbortSignal): Promise<FabricRulesBlock | undefined>;
  /** Force the next `block` to recompute (writes that bypass the memory instance). */
  invalidate(): void;
  /** Recompute and write every `rules.md`, replacing a person's edit that was already reconciled into notes. */
  rewrite(signal?: AbortSignal): Promise<void>;
  /** The rule lines a scope's file holds right now (block and path-scoped), for correction matching. */
  activeRules(level: FabricRulesScope, signal?: AbortSignal): Promise<readonly { readonly id: string; readonly text: string }[]>;
  overflow(): FabricRulesOverflow;
  /** The redaction every rendered line passes, so a reconcile compares like with like. */
  redact(text: string): string;
}

interface RuleLine {
  readonly id: string;
  /** The prompt-block line. */
  readonly line: string;
  readonly tokens: number;
  readonly text: string;
  readonly decision: boolean;
  readonly appliesTo?: readonly string[];
}

/** The heading a scope's rules line starts with. */
export function rulesHeading(label: string): string {
  return `Standing rules (${label}):`;
}

/** `projects/<slug>--<id8>` → `<slug>`; a resource that is not a project id stays `project`. */
function rulesLabel(binding: FabricRulesScopeBinding): string {
  if (binding.level === "user") return "user";
  const resource = binding.memory.scope.resourceId;
  const slug = /^projects\/(.+?)(?:--[0-9a-f]{8})?$/.exec(resource)?.[1];
  return resource.startsWith("projects/") && slug ? `project ${slug}` : "project";
}

interface RuleRow {
  readonly id: string;
  readonly metadata: MemoryNoteMetadata;
  readonly storage: number;
  readonly human: boolean;
  readonly path: boolean;
}

/**
 * Selection and order for one scope: verified, active, unflagged notes of the rule kinds. Human-written
 * rules first (they are never dropped for an agent's), then pinned, standing decisions, descending S, ties
 * by id so the order is stable across rebuilds.
 */
export function ruleCandidateRows(
  rows: readonly MemoryVectorMetadataRow[],
  weights?: StorageWeights,
  kinds: readonly MemoryNoteKind[] = DEFAULT_RULES_KINDS,
): readonly RuleRow[] {
  const found: RuleRow[] = [];
  for (const row of rows) {
    const metadata = parseMemoryNoteMetadata(row.metadata);
    if (metadata === undefined) continue;
    if (normalizeNoteStatus(row.metadata?.status as string | undefined, "verified") !== "verified") continue;
    if (!kinds.includes(metadata.kind)) continue;
    if ((metadata.flags?.length ?? 0) > 0) continue;
    if (!isActiveNote(metadata) || !isMemoryNoteValidAt(metadata, Date.now())) continue;
    if (metadata.kind === "decision" && (metadata.decisionStatus !== "active" || metadata.status === "candidate")) continue;
    found.push({
      id: row.id,
      metadata,
      storage: storageStrength(metadata, weights),
      human: metadata.generated?.by === "human",
      path: metadata.scope === "path",
    });
  }
  return found.sort(
    (left, right) =>
      Number(right.human) - Number(left.human) ||
      Number(right.metadata.pinned === true) - Number(left.metadata.pinned === true) ||
      // A standing decision outranks an ordinary note of the same pin state (plan 202 Task 11).
      Number(right.metadata.kind === "decision") - Number(left.metadata.kind === "decision") ||
      right.storage - left.storage ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

/** One scope's block body and the budget its notes spend; `undefined` content when the scope shows nothing. */
export interface FabricRulesScopeRender {
  readonly level: FabricRulesScope;
  readonly label: string;
  readonly scope: RulesScopeId;
  readonly lines: readonly RuleLine[];
  readonly pathLines: readonly RuleLine[];
  readonly content?: string;
  readonly tokens: number;
  readonly itemIds: readonly string[];
}

/** One scope's block body: the heading plus the note lines, exactly what the model reads of it. */
export function renderRules(label: string, lines: readonly RuleLine[]): { readonly content: string; readonly tokens: number } | undefined {
  if (lines.length === 0) return undefined;
  const content = `${rulesHeading(label)} ${lines.map((line) => line.line).join(" ")}`;
  return { content, tokens: Math.ceil(content.length / 4) };
}

/** Take the longest prefix of `lines` that fits `budget`; a note that does not fit is skipped, not cut. */
function takeLines(lines: readonly RuleLine[], budget: number): { readonly lines: readonly RuleLine[]; readonly tokens: number } {
  const kept: RuleLine[] = [];
  let tokens = 0;
  for (const line of lines) {
    if (tokens + line.tokens > budget) continue;
    kept.push(line);
    tokens += line.tokens;
  }
  return { lines: kept, tokens };
}

// ---------------------------------------------------------------------------------------------------------
// rules.md: render, parse, reconcile
// ---------------------------------------------------------------------------------------------------------

/** One line of `rules.md`: `- [id] text (why: memory.read id)` or `- [id] text (applies to a/**, b/**)`. */
function fileLine(line: RuleLine): string {
  const suffix =
    line.appliesTo !== undefined ? ` (applies to ${line.appliesTo.join(", ")})` : line.decision ? ` (why: memory.read ${line.id})` : "";
  return `- [${line.id}] ${line.text}${suffix}`;
}

/** The body of a scope's `rules.md`. Deterministic: no timestamps, so an unchanged set rewrites nothing. */
export function renderRulesFile(label: string, lines: readonly RuleLine[]): string {
  return [
    `# Standing rules (${label})`,
    "",
    "Add a line to add a rule, delete a line to retire one, change the text to correct one.",
    "An edit is applied when the next session starts.",
    `<!-- prism:rules shown=${lines.map((line) => line.id).join(",")} -->`,
    ...lines.map(fileLine),
    "",
  ].join("\n");
}

export interface ParsedRuleLine {
  readonly id?: string;
  readonly text: string;
  readonly appliesTo?: readonly string[];
}

export interface ParsedRulesFile {
  /** The ids the file listed when it was written; `undefined` when a person removed the comment. */
  readonly shown?: readonly string[];
  readonly lines: readonly ParsedRuleLine[];
}

const SHOWN_COMMENT = /<!--\s*prism:rules shown=([A-Za-z0-9_,-]*)\s*-->/;
const RULE_LINE = /^\s*[-*]\s+(?:\[([A-Za-z0-9_-]{1,64})\]\s+)?(.+?)\s*$/;
const MAX_RULE_TEXT = 1_000;

export function parseRulesFile(body: string): ParsedRulesFile {
  const shownMatch = SHOWN_COMMENT.exec(body);
  const shown = shownMatch === null ? undefined : shownMatch[1]!.split(",").filter((id) => id.length > 0);
  const lines: ParsedRuleLine[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const match = RULE_LINE.exec(raw);
    if (match === null) continue;
    let text = match[2]!;
    let appliesTo: string[] | undefined;
    const why = /\s*\(why: memory\.read [A-Za-z0-9_-]+\)\s*$/.exec(text);
    if (why !== null) text = text.slice(0, why.index);
    const applies = /\s*\(applies to ([^)]+)\)\s*$/.exec(text);
    if (applies !== null) {
      text = text.slice(0, applies.index);
      appliesTo = applies[1]!
        .split(",")
        .map((glob) => glob.trim())
        .filter((glob) => glob.length > 0);
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text.length === 0) continue;
    lines.push({
      ...(match[1] === undefined ? {} : { id: match[1] }),
      text,
      ...(appliesTo === undefined || appliesTo.length === 0 ? {} : { appliesTo: appliesTo.slice(0, 8) }),
    });
  }
  return { ...(shown === undefined ? {} : { shown }), lines };
}

/** Stable id for a rule a person wrote in `rules.md`; a retried reconcile writes the same note again. */
export function ruleLineNoteId(resourceId: string, text: string): string {
  return createHash("sha256").update(`rules-line\0${resourceId}\0${text}`).digest("hex").slice(0, 12);
}

export interface RulesReconcileReport {
  readonly edited: boolean;
  readonly added: number;
  readonly updated: number;
  readonly retired: number;
  /** Lines the trust scan or a write refused; they do not become notes. */
  readonly refused: number;
}

export const NO_RULES_EDIT: RulesReconcileReport = Object.freeze({ edited: false, added: 0, updated: 0, retired: 0, refused: 0 });

export interface RulesReconcileInput {
  readonly binding: FabricRulesScopeBinding;
  readonly kinds: readonly MemoryNoteKind[];
  readonly read: (scope: RulesScopeId) => Promise<{ readonly body: string; readonly edited: boolean } | undefined>;
  readonly redact: (text: string) => string;
  readonly remember: (input: MemoryFabricRememberInput, options: MemoryFabricWriteOptions) => Promise<{ readonly id: string }>;
  readonly pin: (id: string) => Promise<boolean>;
  readonly retire: (id: string) => Promise<boolean>;
  /** Write every `rules.md` again so the consumed edit is replaced by the new rendered set. */
  readonly rewrite: (signal?: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
}

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Fold a person's edit of one scope's `rules.md` into notes (once per session; one file read and one hash
 * compare when nothing was edited). The file is replaced only after every line was applied, and the note
 * ids are deterministic, so a failed pass is retried whole at the next session without duplicates.
 */
export async function reconcileRulesFile(input: RulesReconcileInput): Promise<RulesReconcileReport> {
  const { binding } = input;
  const scope = { tenantId: binding.memory.scope.tenantId, resourceId: binding.memory.scope.resourceId };
  const file = await input.read(scope);
  if (file === undefined || !file.edited) return NO_RULES_EDIT;
  const parsed = parseRulesFile(file.body);
  const mentioned = [...new Set([...(parsed.shown ?? []), ...parsed.lines.flatMap((line) => (line.id === undefined ? [] : [line.id]))])];
  const records =
    mentioned.length === 0 ? [] : await binding.memory.get(mentioned, input.signal === undefined ? {} : { signal: input.signal });
  const current = new Map<string, { readonly text: string; readonly metadata: MemoryNoteMetadata }>();
  for (const record of records) {
    const metadata = parseMemoryNoteMetadata(record.metadata);
    if (metadata !== undefined && isActiveNote(metadata) && isMemoryNoteValidAt(metadata, Date.now())) {
      current.set(record.id, { text: squash(input.redact(record.text)), metadata });
    }
  }
  let added = 0;
  let updated = 0;
  let retired = 0;
  let refused = 0;
  const keptIds = new Set<string>();
  const writeKind: MemoryNoteKind = input.kinds.includes("preference") ? "preference" : input.kinds[0]!;
  for (const line of parsed.lines) {
    if (line.text.length > MAX_RULE_TEXT || !scanScopedMemoryContent(line.text).ok) {
      refused += 1;
      continue;
    }
    const existing = line.id === undefined ? undefined : current.get(line.id);
    if (existing !== undefined && line.id !== undefined) {
      keptIds.add(line.id);
      if (existing.text === line.text) continue;
      const old = existing.metadata;
      const base = {
        kind: old.kind,
        content: line.text,
        id: ruleLineNoteId(scope.resourceId, line.text),
        supersedes: line.id,
        ...(old.scope === undefined ? {} : { scope: old.scope }),
        ...(old.appliesTo === undefined ? {} : { appliesTo: old.appliesTo }),
        ...(old.kind === "decision" ? { rationale: old.rationale ?? "edited in rules.md", decisionStatus: "active" as const } : {}),
      } satisfies MemoryFabricRememberInput;
      try {
        const note = await input.remember(base, { generatedBy: "human" });
        await input.pin(note.id);
        updated += 1;
      } catch {
        refused += 1;
      }
      continue;
    }
    const id = ruleLineNoteId(scope.resourceId, line.text);
    keptIds.add(id);
    const pathScoped = line.appliesTo !== undefined;
    try {
      const note = await input.remember(
        {
          kind: writeKind,
          content: line.text,
          id,
          scope: pathScoped ? "path" : binding.level,
          ...(pathScoped ? { appliesTo: line.appliesTo } : {}),
          ...(writeKind === "decision" ? { rationale: "added by hand in rules.md", decisionStatus: "active" as const } : {}),
        },
        { generatedBy: "human" },
      );
      await input.pin(note.id);
      added += 1;
    } catch {
      refused += 1;
    }
  }
  // A listed id that the edit dropped is a retirement; with no id comment there is nothing to compare to.
  for (const id of parsed.shown ?? []) {
    if (keptIds.has(id) || !current.has(id)) continue;
    // A changed line keeps its id and was handled above; only a removed line reaches here.
    if (await input.retire(id)) retired += 1;
  }
  await input.rewrite(input.signal);
  return { edited: true, added, updated, retired, refused };
}

// ---------------------------------------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------------------------------------

export function createFabricRules(input: CreateFabricRulesOptions): FabricRules {
  const redactor = resolveRedactor(input.redactor, input.secrets);
  const redact = (text: string): string => redactJson(text, redactor).replace(/\s+/g, " ").trim();
  const { maxTokens } = input.options;
  const bindings = input.options.scopes.flatMap((level) => {
    const binding = input.scopes.find((scope) => scope.level === level);
    return binding === undefined ? [] : [binding];
  });
  let forced = 0;
  let warnedWrite = false;
  let replaceEdited = false;
  let cached: { readonly key: string; readonly value: FabricRulesBlock | undefined } | undefined;
  let overflow: FabricRulesOverflow = { shown: 0, more: 0, humanDropped: 0 };

  interface ScopeRules {
    readonly lines: readonly RuleLine[];
    readonly pathLines: readonly RuleLine[];
    readonly total: number;
    readonly humanIds: readonly string[];
  }

  /** The ordered rule lines of one scope: block candidates capped at the whole budget, plus path rules. */
  async function scopeLines(binding: FabricRulesScopeBinding, signal: AbortSignal | undefined): Promise<ScopeRules> {
    const { memory } = binding;
    const query = {
      scope: { tenantId: memory.scope.tenantId, resourceId: memory.scope.resourceId },
      limit: RULES_SCAN_PAGE,
      ...(signal === undefined ? {} : { signal }),
    };
    const page = await input.scanMetadata(query);
    const ordered = ruleCandidateRows(page.rows, input.storageWeights, input.options.kinds);
    const blockRows = ordered.filter((row) => !row.path);
    const pathRows = ordered.filter((row) => row.path).slice(0, MAX_FILE_PATH_RULES);
    const lines: RuleLine[] = [];
    let tokens = 0;
    const build = (row: RuleRow, body: string): RuleLine => {
      const text = redact(body);
      const decision = row.metadata.kind === "decision";
      const line = `[${row.id}] ${text}${decision ? ` — why: memory.read ${row.id}` : ""}`;
      return {
        id: row.id,
        line,
        tokens: Math.ceil((line.length + 1) / 4),
        text,
        decision,
        ...(row.path ? { appliesTo: row.metadata.appliesTo ?? [] } : {}),
      };
    };
    for (let index = 0; index < blockRows.length && tokens < maxTokens; ) {
      const batch = blockRows.slice(index, index + RULES_GET_BATCH);
      index += batch.length;
      // A revoked, invalidated, or unreadable note has no text here and never enters the rules.
      const records = await memory.get(
        batch.map((row) => row.id),
        signal === undefined ? {} : { signal },
      );
      const text = new Map(records.map((record) => [record.id, record.text]));
      for (const row of batch) {
        const body = text.get(row.id);
        if (body === undefined) continue;
        const line = build(row, body);
        if (tokens + line.tokens > maxTokens) continue;
        lines.push(line);
        tokens += line.tokens;
      }
    }
    const pathLines: RuleLine[] = [];
    if (pathRows.length > 0) {
      const records = await memory.get(
        pathRows.map((row) => row.id),
        signal === undefined ? {} : { signal },
      );
      const text = new Map(records.map((record) => [record.id, record.text]));
      for (const row of pathRows) {
        const body = text.get(row.id);
        if (body !== undefined) pathLines.push(build(row, body));
      }
    }
    return { lines, pathLines, total: blockRows.length, humanIds: blockRows.filter((row) => row.human).map((row) => row.id) };
  }

  /** Split `budget` between scopes: the first takes the remainder; unused budget flows to the other. */
  function allocate(
    lineLists: readonly (readonly RuleLine[])[],
    budget: number,
  ): readonly { readonly taken: readonly RuleLine[]; readonly tokens: number }[] {
    const share = Math.floor(budget / bindings.length);
    const result: { taken: readonly RuleLine[]; tokens: number }[] = [];
    let remaining = budget;
    for (const [index, binding] of bindings.entries()) {
      const label = rulesLabel(binding);
      const nominal = share + (index === 0 ? budget - share * bindings.length : 0);
      const headingTokens = Math.ceil((rulesHeading(label).length + 1) / 4);
      const taken = takeLines(lineLists[index]!, Math.min(remaining, nominal) - headingTokens);
      const rendered = renderRules(label, taken.lines);
      result.push({ taken: taken.lines, tokens: rendered?.tokens ?? 0 });
      remaining -= rendered?.tokens ?? 0;
    }
    // The other direction: a scope that stopped short of its half leaves budget for the first scope.
    if (remaining > 0) {
      for (const [index, binding] of bindings.entries()) {
        const current = result[index]!;
        if (current.taken.length === lineLists[index]!.length) continue;
        const headingTokens = Math.ceil((rulesHeading(rulesLabel(binding)).length + 1) / 4);
        const taken = takeLines(lineLists[index]!, current.tokens + remaining - headingTokens);
        const rendered = renderRules(rulesLabel(binding), taken.lines);
        remaining -= (rendered?.tokens ?? 0) - current.tokens;
        result[index] = { taken: taken.lines, tokens: rendered?.tokens ?? 0 };
        if (remaining <= 0) break;
      }
    }
    return result;
  }

  async function compute(signal: AbortSignal | undefined): Promise<FabricRulesBlock | undefined> {
    if (bindings.length === 0) return undefined;
    const scopeRules = await Promise.all(bindings.map((binding) => scopeLines(binding, signal)));
    const lineLists = scopeRules.map((entry) => entry.lines);
    let allocation = allocate(lineLists, maxTokens);
    const total = scopeRules.reduce((sum, entry) => sum + entry.total, 0);
    let shown = allocation.reduce((sum, entry) => sum + entry.taken.length, 0);
    // Rules the budget left out stay recallable; the block says so, inside the same budget.
    if (shown < total && maxTokens > OVERFLOW_LINE_TOKENS * 2) {
      allocation = allocate(lineLists, maxTokens - OVERFLOW_LINE_TOKENS);
      shown = allocation.reduce((sum, entry) => sum + entry.taken.length, 0);
    }
    const more = Math.max(0, total - shown);
    const renders: FabricRulesScopeRender[] = bindings.map((binding, index) => {
      const taken = allocation[index]!.taken;
      const label = rulesLabel(binding);
      const rendered = renderRules(label, taken);
      return {
        level: binding.level,
        label,
        scope: { tenantId: binding.memory.scope.tenantId, resourceId: binding.memory.scope.resourceId },
        lines: taken,
        pathLines: scopeRules[index]!.pathLines,
        ...(rendered === undefined ? {} : { content: rendered.content }),
        tokens: rendered?.tokens ?? 0,
        itemIds: taken.map((line) => line.id),
      };
    });
    const shownIds = new Set(renders.flatMap((render) => render.itemIds));
    overflow = {
      shown,
      more,
      humanDropped: scopeRules.reduce((sum, entry) => sum + entry.humanIds.filter((id) => !shownIds.has(id)).length, 0),
    };
    if (input.writeFile !== undefined) await writeRulesFiles(renders);
    const visible = renders.filter((render) => render.content !== undefined);
    if (visible.length === 0) return undefined;
    const body = visible.map((render) => render.content).join("\n");
    const content = more > 0 ? `${body}\nrules: ${shown} shown, ${more} more — memory.recall` : body;
    return {
      content,
      tokens: Math.ceil(content.length / 4),
      itemIds: visible.flatMap((render) => [...render.itemIds]),
    };
  }

  async function writeRulesFiles(renders: readonly FabricRulesScopeRender[]): Promise<void> {
    try {
      for (const render of renders) {
        const body = renderRulesFile(render.label, [...render.lines, ...render.pathLines]);
        await input.writeFile!(render.scope, body, replaceEdited ? { replaceEdited: true } : {});
      }
    } catch (error) {
      if (warnedWrite) return;
      warnedWrite = true;
      input.notify?.(`memory-fabric: writing rules.md failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  async function currentBlock(signal: AbortSignal | undefined): Promise<FabricRulesBlock | undefined> {
    const key = `${bindings.reduce((sum, binding) => sum + memoryWriteVersion(binding.memory), 0)}:${forced}`;
    if (cached?.key === key) return cached.value;
    // Keyed by the version read before the query, so a write landing mid-compute is picked up next time.
    const value = await compute(signal);
    cached = { key, value };
    return value;
  }

  return {
    block: (signal) => currentBlock(signal),
    invalidate() {
      forced += 1;
    },
    async rewrite(signal) {
      replaceEdited = true;
      forced += 1;
      try {
        await currentBlock(signal);
      } finally {
        replaceEdited = false;
      }
    },
    async activeRules(level, signal) {
      const binding = bindings.find((entry) => entry.level === level);
      if (binding === undefined) return [];
      const scoped = await scopeLines(binding, signal);
      return [...scoped.lines, ...scoped.pathLines].map((line) => ({ id: line.id, text: line.text }));
    },
    overflow: () => overflow,
    redact,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Capture and confirmation
// ---------------------------------------------------------------------------------------------------------

const DECISION_CUE =
  /\b(?:from now on|always|(?<!\b(?:i|we|you|they|he|she|have|has|had)\s)never|we(?:'ve| have)? decided|use\b[^.!?\n]{0,200}\binstead of|no[,:])/iu;
const PREFERENCE_CUE = /\b(?:i prefer|i(?:'d| would) rather|my preference is|i (?:really )?(?:don't|do not) like)\b/iu;
const PROCEDURE_CUE =
  /\b(?:make sure (?:to|you)|remember to|before you (?:commit|push|merge|deploy|release|finish)|whenever you|each time you|every time you)\b/iu;

/** One sentence, capitalised; strips the cue lead-in that carries no rule content. */
function sentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = /[.!?](?:\s|$)/.exec(clean);
  const first = (end === null ? clean : clean.slice(0, end.index + 1)).trim();
  return first.length === 0 ? first : first[0]!.toUpperCase() + first.slice(1);
}

/** `for src/payments/**` / `in src/payments` → a path scope; a bare directory becomes `dir/**`. */
function pathScope(rule: string): { scope: "path"; appliesTo: readonly string[] } | undefined {
  const match = /\b(?:for|in|under)\s+((?:\.\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_./*-]+)/iu.exec(rule);
  if (match === null) return undefined;
  const raw = match[1]!.replace(/^\.\//, "").replace(/[.,;:]$/, "");
  if (raw.length === 0 || raw.startsWith("/") || raw.includes("..")) return undefined;
  const glob = raw.includes("*") ? raw : `${raw.replace(/\/$/, "")}/**`;
  return { scope: "path", appliesTo: [glob] };
}

function cueLine(userText: string, cue: RegExp): { readonly line: string; readonly index: number } | undefined {
  for (const line of userText.split(/\r?\n/)) {
    const match = cue.exec(line);
    if (match !== null) return { line, index: match.index };
  }
  return undefined;
}

/**
 * Extract one proposed rule from a user turn: a preference ("I prefer…"), a procedure ("make sure to…") or
 * a decision ("from now on…", "use X instead of Y", "no, …") with its rationale. `undefined` when no cue is
 * present or the trust scan refuses the rule or its rationale. Never a model call; the input is the archived
 * user turn only.
 */
export function captureRule(userText: string, sourceEntryIds: readonly string[]): MemoryFabricRememberInput | undefined {
  const preference = cueLine(userText, PREFERENCE_CUE);
  if (preference !== undefined) {
    const content = sentence(preference.line.slice(preference.index));
    if (content.length === 0 || !scanScopedMemoryContent(content).ok) return undefined;
    return { kind: "preference", content, scope: "user", sourceEntryIds: [...sourceEntryIds] };
  }
  const procedure = cueLine(userText, PROCEDURE_CUE);
  if (procedure !== undefined) {
    const content = sentence(procedure.line.slice(procedure.index));
    if (content.length === 0 || !scanScopedMemoryContent(content).ok) return undefined;
    const scoped = pathScope(content);
    return {
      kind: "procedure",
      content,
      ...(scoped === undefined ? { scope: "project" as const } : scoped),
      sourceEntryIds: [...sourceEntryIds],
    };
  }
  const decision = cueLine(userText, DECISION_CUE);
  if (decision === undefined) return undefined;
  let rule = decision.line.slice(decision.index);
  rule = rule.replace(/^\s*from now on[,:]?\s*/iu, "").replace(/^\s*we(?:'ve| have)? decided(?: that)?[,:]?\s*/iu, "");
  rule = rule.replace(/^\s*(?:no|actually)[,:]\s*/iu, "");
  const because = /\s+because\s+/iu.exec(rule);
  const rationale = because === null ? "stated as a lasting decision" : sentence(rule.slice(because.index + because[0].length));
  if (because !== null) rule = rule.slice(0, because.index);
  const content = sentence(rule);
  if (content.length === 0) return undefined;
  const scan = scanScopedMemoryContent(`${content}\n${rationale}`);
  if (!scan.ok) return undefined;
  const scoped = pathScope(content);
  return {
    kind: "decision",
    content,
    rationale,
    ...(scoped === undefined ? { scope: "project" as const } : scoped),
    decisionStatus: "proposed",
    sourceEntryIds: [...sourceEntryIds],
  };
}

/**
 * The id of the active rule a correction replaces: "use zod instead of yup" names `yup`, and the first
 * active rule that mentions it is the one corrected. Lexical; `undefined` when the turn names nothing.
 */
export function findCorrectedRule(
  proposalText: string,
  rules: readonly { readonly id: string; readonly text: string }[],
): string | undefined {
  const named = /\b(?:instead of|rather than|not)\s+([A-Za-z0-9_.@/-]{3,64})/iu.exec(proposalText)?.[1]?.replace(/[.,;:]$/, "");
  if (named === undefined) return undefined;
  const needle = named.toLowerCase();
  return rules.find((rule) => rule.text.toLowerCase().includes(needle) && rule.text.trim() !== proposalText.trim())?.id;
}

/** Stable id makes a repeated archive pass idempotent without a second lookup index. */
export function ruleNoteId(sessionId: string, userEntryId: string): string {
  return createHash("sha256").update(`rule\0${sessionId}\0${userEntryId}`).digest("hex").slice(0, 12);
}

/** Only a confirmed, verified decision is delivered passively. */
export function isDecisionDeliverable(metadata: Pick<MemoryNoteMetadata, "kind" | "decisionStatus" | "status">): boolean {
  return metadata.kind !== "decision" || (metadata.decisionStatus === "active" && metadata.status !== "candidate");
}

export interface RuleProposal {
  readonly id: string;
  readonly kind?: MemoryNoteKind;
  readonly text: string;
  readonly rationale?: string;
}

/**
 * One batched `host.ui` confirmation for the proposals of this turn. Unavailable, denied, dismissed,
 * malformed, or throwing UI answers all leave the proposals `proposed` (fail closed).
 */
export async function confirmRuleProposals(ui: HostUi | undefined, proposals: readonly RuleProposal[]): Promise<readonly string[]> {
  if (ui === undefined || proposals.length === 0) return [];
  try {
    const answer = await ui.request({
      kind: "confirm",
      title: proposals.length === 1 ? "Activate this standing rule?" : `Activate ${proposals.length} standing rules?`,
      detail: proposals
        .map(
          (proposal) =>
            `[${proposal.id}] ${proposal.kind === undefined ? "" : `${proposal.kind}: `}${proposal.text}${proposal.rationale ? ` — why: ${proposal.rationale}` : ""}`,
        )
        .join("\n"),
    });
    return answer.status === "answered" && answer.value === true ? proposals.map((proposal) => proposal.id) : [];
  } catch {
    return [];
  }
}

export interface RuleCaptureInput {
  readonly sessionId: string;
  /** The archived user turn: never tool output or assistant text. */
  readonly userText: string;
  readonly userEntryId: string;
  readonly assistantEntryId: string;
  readonly ui: HostUi | undefined;
  /** P1/P7 gate (plan 202): `false` durable or instruction-like turns capture nothing. */
  readonly gate?: { readonly durable?: boolean; readonly instructionLike?: boolean } | undefined;
  readonly remember: (
    input: MemoryFabricRememberInput,
    options: MemoryFabricWriteOptions,
  ) => Promise<{ readonly id: string; readonly content: string; readonly rationale?: string }>;
  readonly verify: (id: string) => Promise<boolean>;
  readonly pin: (id: string) => Promise<boolean>;
  readonly supersede: (id: string) => Promise<boolean>;
  readonly activeRules: (level: FabricRulesScope) => Promise<readonly { readonly id: string; readonly text: string }[]>;
  readonly signal?: AbortSignal;
}

/**
 * Capture, confirm, activate: a proposal is written `candidate`, asked once through `host.ui`, and only an
 * explicit yes verifies and pins it. A correction retires the rule it names (the old note keeps its history,
 * `validTo` set). Nothing is asked or written when the turn carries no cue or the gate refuses it.
 */
export async function captureAndConfirmRule(input: RuleCaptureInput): Promise<{ readonly proposed: boolean; readonly activated: boolean }> {
  if (input.gate?.instructionLike === true) return { proposed: false, activated: false };
  const proposal = captureRule(input.userText, [input.userEntryId, input.assistantEntryId]);
  if (proposal === undefined) return { proposed: false, activated: false };
  const note = await input.remember(
    { ...proposal, id: ruleNoteId(input.sessionId, input.userEntryId), session: input.sessionId },
    { sessionId: input.sessionId, status: "candidate", ...(input.signal === undefined ? {} : { signal: input.signal }) },
  );
  const approved = await confirmRuleProposals(input.ui, [
    { id: note.id, kind: proposal.kind, text: note.content, ...(note.rationale === undefined ? {} : { rationale: note.rationale }) },
  ]);
  if (!approved.includes(note.id)) return { proposed: true, activated: false };
  await input.verify(note.id);
  await input.pin(note.id);
  const level: FabricRulesScope = proposal.scope === "user" ? "user" : "project";
  const corrected = findCorrectedRule(
    note.content,
    (await input.activeRules(level)).filter((rule) => rule.id !== note.id),
  );
  if (corrected !== undefined) await input.supersede(corrected);
  return { proposed: true, activated: true };
}
