/** Attention Compiler (plan 074 Tasks 2–3): frozen contracts, the ratio gate, and the two
 *  sticky stages (thinking strip, then old tool-result stubs). Creation is synchronous and
 *  fails closed; `compileAttention` measures the assembled request once, rewrites only the
 *  `history` / `toolResults` groups, and never touches the store, the om ledger, or the
 *  frozen prefix. The assembly branch lives in `input.ts`; opt-in agent wiring (Task 5) is not
 *  part of this module. */

import { createHash } from "node:crypto";
import {
  type ContextBudgetMessageGroups,
  estimateMessageBytes,
  estimateMessageTokens,
  estimateTextBytes,
  measureInputCost,
} from "./context-budget.js";
import type {
  AttentionCompiler,
  AttentionCompilerContext,
  AttentionCompilerOptions,
  AttentionCompilerSetting,
  AttentionInputCapOptions,
  AttentionReport,
  ContextBlock,
  Message,
  Skill,
  ToolDefinition,
  ToolResultContent,
} from "./contracts.js";
import { assertCompactionTrigger, type CompactionTrigger } from "./contracts-core/compaction.js";
import type { SecretRedactor } from "./redaction.js";
import {
  capToolResultSummary,
  foldedToolResultHeader,
  inferToolResultTurns,
  type ResolvedToolResultFoldOptions,
  toolResultFoldText,
} from "./tool-result-fold.js";

export const ATTENTION_BUDGET_ERROR_CODE = "attention_budget_exceeded" as const;

/** C9: still over `triggerRatio` after every eligible stage — host should compact, not delete. */
export class AttentionBudgetError extends Error {
  readonly code = ATTENTION_BUDGET_ERROR_CODE;
  constructor(message = "attention budget exceeded: still over triggerRatio after stub stages") {
    super(message);
    this.name = "AttentionBudgetError";
  }
}

export function isAttentionBudgetError(error: unknown): error is AttentionBudgetError {
  return error instanceof Error && (error as { code?: unknown }).code === ATTENTION_BUDGET_ERROR_CODE;
}

export const DEFAULT_ATTENTION_TRIGGER_RATIO = 0.75;
export const DEFAULT_ATTENTION_COMPACT_RATIO = 0.9;
export const DEFAULT_ATTENTION_THINKING_KEEP_TURNS = 1;
export const DEFAULT_ATTENTION_KEEP_LAST = 3;
export const DEFAULT_ATTENTION_RESERVE_TOKENS = 1024;

/** Matches the run allow-list caps in `tools.ts`: no more tool names than a run could hold. */
const MAX_EXCLUDE_TOOL_NAMES = 1_024;
const MAX_TOOL_NAME_CHARS = 256;

function resolveRatio(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || (value as number) <= 0 || (value as number) >= 1) {
    throw new TypeError(`${name} must be a number in (0, 1)`);
  }
  return value as number;
}

function resolveCount(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

export function resolveAttentionReserveTokens(value: unknown): number {
  return resolveCount(value, DEFAULT_ATTENTION_RESERVE_TOKENS, "attentionCompiler.reserveTokens");
}

/** C2: host `maxInputTokens` wins; otherwise `contextWindow - (maxOutputTokens ?? 0) - reserve`.
 *  Shared with the `input_ratio` compaction trigger (Task 4). Throws when no cap can be derived. */
export function resolveInputCap(options: AttentionInputCapOptions = {}, model?: AttentionCompilerContext["model"]): number {
  const reserveTokens = resolveAttentionReserveTokens(options.reserveTokens);
  if (options.maxInputTokens !== undefined) {
    if (!Number.isSafeInteger(options.maxInputTokens) || options.maxInputTokens < 1) {
      throw new TypeError("attentionCompiler.maxInputTokens must be a positive safe integer");
    }
    return options.maxInputTokens;
  }
  const window = model?.limits?.contextWindow;
  if (!Number.isSafeInteger(window) || (window as number) <= 0) {
    throw new TypeError("attentionCompiler requires maxInputTokens or model.limits.contextWindow");
  }
  const maxOutputTokens = model?.limits?.maxOutputTokens;
  if (maxOutputTokens !== undefined && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 0)) {
    throw new TypeError("attentionCompiler requires model.limits.maxOutputTokens to be a non-negative safe integer");
  }
  const cap = (window as number) - (maxOutputTokens ?? 0) - reserveTokens;
  if (cap <= 0) {
    throw new TypeError(`attentionCompiler resolved a non-positive input cap (${cap}): raise contextWindow or lower reserveTokens`);
  }
  return cap;
}

function resolveExcludeTools(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError("attentionCompiler.excludeTools must be an array of tool names");
  if (value.length > MAX_EXCLUDE_TOOL_NAMES) {
    throw new TypeError(`attentionCompiler.excludeTools exceeds ${MAX_EXCLUDE_TOOL_NAMES} entries`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of value) {
    if (typeof name !== "string" || name.length === 0 || name.length > MAX_TOOL_NAME_CHARS) {
      throw new TypeError(`attentionCompiler.excludeTools entries must be non-empty strings of at most ${MAX_TOOL_NAME_CHARS} characters`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return Object.freeze(out);
}

/** Validate compiler options + resolve the input cap. No provider I/O; unknown or
 *  unresolvable input throws here rather than on the first turn. */
export function createAttentionCompiler(options: AttentionCompilerOptions = {}, context: AttentionCompilerContext = {}): AttentionCompiler {
  if (typeof options !== "object" || options === null) throw new TypeError("attentionCompiler options must be an object");
  const triggerRatio = resolveRatio(options.triggerRatio, DEFAULT_ATTENTION_TRIGGER_RATIO, "attentionCompiler.triggerRatio");
  const compactRatio = resolveRatio(options.compactRatio, DEFAULT_ATTENTION_COMPACT_RATIO, "attentionCompiler.compactRatio");
  if (compactRatio <= triggerRatio) {
    throw new TypeError(`attentionCompiler.compactRatio (${compactRatio}) must exceed triggerRatio (${triggerRatio})`);
  }
  const thinkingKeepTurns = resolveCount(
    options.thinkingKeepTurns,
    DEFAULT_ATTENTION_THINKING_KEEP_TURNS,
    "attentionCompiler.thinkingKeepTurns",
  );
  const keepLast = resolveCount(options.keepLast, DEFAULT_ATTENTION_KEEP_LAST, "attentionCompiler.keepLast");
  const inputCap = resolveInputCap(options, context.model);
  const reserveTokens = resolveAttentionReserveTokens(options.reserveTokens);
  const excludeTools = resolveExcludeTools(options.excludeTools);

  const trigger: CompactionTrigger | undefined = context.compactionTrigger;
  if (trigger !== undefined) {
    assertCompactionTrigger(trigger);
    if (trigger.type === "input_ratio" && trigger.ratio <= triggerRatio) {
      throw new TypeError(`compaction input_ratio (${trigger.ratio}) must exceed attentionCompiler.triggerRatio (${triggerRatio})`);
    }
  }

  return Object.freeze({ inputCap, reserveTokens, triggerRatio, compactRatio, thinkingKeepTurns, keepLast, excludeTools });
}

/* ------------------------------------------------------------------------------------------------
 * Opt-in wiring (Task 5)
 * ------------------------------------------------------------------------------------------------ */

/** Effective agent setting: `true` → defaults, object → as given, anything falsy → off. */
function enabledAttentionSetting(value: AttentionCompilerSetting | undefined): AttentionCompilerOptions | undefined {
  if (value === true) return {};
  if (value === undefined || value === false) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("attentionCompiler must be a boolean or an options object");
  }
  return value;
}

/** Run overlays may only lower the gate (higher ratios) and deepen the stages (lower keep
 *  counts); extending `excludeTools` protects more rows, so it is additive-only. Cap inputs
 *  stay config-level: moving them would move the gate itself. */
function mergeAttentionRunOverlay(base: AttentionCompilerOptions, overlay: AttentionCompilerOptions): AttentionCompilerOptions {
  const gate = (key: "triggerRatio" | "compactRatio", fallback: number): number | undefined => {
    const value = overlay[key];
    if (value === undefined) return undefined;
    const floor = base[key] ?? fallback;
    if (value < floor) {
      throw new TypeError(
        `RunOptions.attentionCompiler.${key} (${String(value)}) must not be more aggressive than the agent setting (${floor})`,
      );
    }
    return value;
  };
  const depth = (key: "keepLast" | "thinkingKeepTurns", fallback: number): number | undefined => {
    const value = overlay[key];
    if (value === undefined) return undefined;
    const ceiling = base[key] ?? fallback;
    if (value > ceiling) {
      throw new TypeError(
        `RunOptions.attentionCompiler.${key} (${String(value)}) must not protect more than the agent setting (${ceiling})`,
      );
    }
    return value;
  };
  if (overlay.maxInputTokens !== undefined || overlay.reserveTokens !== undefined) {
    throw new TypeError("RunOptions.attentionCompiler must not set maxInputTokens or reserveTokens: the input cap is agent-config only");
  }
  const triggerRatio = gate("triggerRatio", DEFAULT_ATTENTION_TRIGGER_RATIO);
  const compactRatio = gate("compactRatio", DEFAULT_ATTENTION_COMPACT_RATIO);
  const keepLast = depth("keepLast", DEFAULT_ATTENTION_KEEP_LAST);
  const thinkingKeepTurns = depth("thinkingKeepTurns", DEFAULT_ATTENTION_THINKING_KEEP_TURNS);
  const excludeTools = [...(base.excludeTools ?? []), ...(overlay.excludeTools ?? [])];
  return {
    ...base,
    ...(triggerRatio !== undefined && { triggerRatio }),
    ...(compactRatio !== undefined && { compactRatio }),
    ...(keepLast !== undefined && { keepLast }),
    ...(thinkingKeepTurns !== undefined && { thinkingKeepTurns }),
    ...(excludeTools.length > 0 && { excludeTools }),
  };
}

/** Resolve the run's compiler from the agent setting plus an optional run overlay, validating
 *  both eagerly (no provider I/O) so a typo fails at run start, not on some later turn (C12).
 *  Returns `undefined` when the compiler is off — the assembly path then allocates nothing. */
export function resolveRunAttentionCompiler(
  agent: AttentionCompilerSetting | undefined,
  run: AttentionCompilerSetting | undefined,
  model: AttentionCompilerContext["model"],
): AttentionCompiler | undefined {
  const enabled = enabledAttentionSetting(agent);
  if (enabled === undefined) {
    if (run !== undefined && run !== false) {
      throw new TypeError(
        "RunOptions.attentionCompiler requires AgentConfig.attentionCompiler: a run may disable or relax the compiler, never enable it",
      );
    }
    return undefined;
  }
  if (run === false) return undefined;
  if (run === undefined || run === true) return createAttentionCompiler(enabled, { model });
  if (typeof run !== "object" || run === null || Array.isArray(run)) {
    throw new TypeError("RunOptions.attentionCompiler must be false or an options object");
  }
  return createAttentionCompiler(mergeAttentionRunOverlay(enabled, run), { model });
}

/* ------------------------------------------------------------------------------------------------
 * Sticky stages (Task 3)
 * ------------------------------------------------------------------------------------------------ */

/** Caller-owned sticky frontier: what this session leaf already mutated (C10). Mutations are
 *  monotonic, so a stubbed call stays stubbed and stripped thinking stays stripped even on a
 *  later under-ratio turn — restoring either would rewrite the prompt-cache prefix. */
export interface AttentionStickyFrontier {
  /** SHA-256 keys of assistant messages whose thinking blocks were stripped. */
  readonly thinking: Set<string>;
  /** Tool call ids whose results were stubbed. */
  readonly toolCallIds: Set<string>;
}

export function createAttentionStickyFrontier(): AttentionStickyFrontier {
  return { thinking: new Set<string>(), toolCallIds: new Set<string>() };
}

/** Host decision/effect payloads are never stubbed (C6): any of these metadata keys on a tool
 *  message protects the row. Hosts with decision tools should list them in `excludeTools`. */
const PROTECTED_TOOL_RESULT_METADATA_KEYS = [
  "approval",
  "approvalId",
  "prismApproval",
  "decision",
  "decisions",
  "pendingDecisions",
  "elicitation",
] as const;

const THINKING_KEY_BYTES = 32;

export interface AttentionCompileOptions {
  readonly compiler: AttentionCompiler;
  /** The exact groups the assembler will send; only `history` and `toolResults` are rewritten. */
  readonly groups: ContextBudgetMessageGroups;
  readonly context?: readonly ContextBlock[];
  readonly skills?: readonly Skill[];
  readonly tools?: readonly ToolDefinition[];
  /** Host fold: its `summarize` wins for the rows the compiler picks, and its age/byte gates
   *  decide fold-eligibility. Omitted → the deterministic stub and `keepLast` alone. */
  readonly fold?: ResolvedToolResultFoldOptions;
  readonly frontier?: AttentionStickyFrontier;
  readonly redactor?: SecretRedactor;
  readonly signal?: AbortSignal;
  readonly turn?: number;
  readonly sessionId?: string;
  readonly runId?: string;
}

export interface AttentionCompilation {
  /** The input groups unchanged when nothing was mutated; otherwise a new object with the
   *  rewritten `history` / `toolResults` arrays. The input groups are never mutated. */
  readonly groups: ContextBudgetMessageGroups;
  readonly mutated: boolean;
  readonly report: AttentionReport;
}

/**
 * Measure once, then mutate oldest-first until back under `triggerRatio` (C4), or throw
 * `AttentionBudgetError` when every eligible row is exhausted (C9). Front-of-frozen-prefix
 * (instructions, summaries, input) is never touched, and neither are the caller's arrays.
 */
export async function compileAttention(options: AttentionCompileOptions): Promise<AttentionCompilation> {
  const { compiler, groups } = options;
  const turn = options.turn ?? 1;
  const frontier = options.frontier;
  const triggerTokens = compiler.triggerRatio * compiler.inputCap;
  const usedAtStart = measureInputCost({ groups, context: options.context, skills: options.skills, tools: options.tools }).tokens;
  let used = usedAtStart;
  const over = () => used >= triggerTokens;

  const history = [...groups.history];
  const toolResults = [...groups.toolResults];
  let droppedThinkingTurns = 0;
  let stubbedToolResults = 0;
  let stubbedBytes = 0;
  let leftEligible = 0;

  // Stage 1 — strip thinking from every assistant turn except the newest `thinkingKeepTurns`.
  const rowTurns = inferToolResultTurns(history);
  for (const index of thinkingTargetIndexes(history, compiler.thinkingKeepTurns)) {
    const message = history[index];
    if (!message) continue;
    const key = thinkingKey(message, options.redactor);
    const sticky = frontier?.thinking.has(key) === true;
    if (!sticky && !over()) {
      leftEligible += 1;
      continue;
    }
    const stripped: Message = { ...message, content: message.content.filter((part) => part.type !== "thinking") };
    history[index] = stripped;
    used -= estimateMessageTokens(message) - estimateMessageTokens(stripped);
    droppedThinkingTurns += 1;
    rememberThinking(frontier, key);
  }

  // Stage 2 — stub the oldest tool results beyond the newest `keepLast` rows, across history
  // and the in-flight group (which is always newer than history).
  for (const target of toolResultTargets({ history, toolResults, rowTurns, turn, compiler, fold: options.fold })) {
    const sticky = frontier?.toolCallIds.has(target.toolCallId) === true;
    if (!sticky && !over()) {
      leftEligible += 1;
      continue;
    }
    const stubbed = await stubToolResultMessage(target, options);
    const before = estimateMessageTokens(target.message);
    const after = estimateMessageTokens(stubbed);
    if (after >= before && !sticky) {
      // The stub would cost more than the payload it replaces: leave the row alone.
      leftEligible += 1;
      continue;
    }
    const beforeBytes = estimateMessageBytes(target.message);
    target.update(stubbed);
    used -= before - after;
    stubbedToolResults += 1;
    stubbedBytes += Math.max(0, beforeBytes - estimateMessageBytes(stubbed));
    rememberToolCall(frontier, target.toolCallId);
  }

  if (over()) {
    throw new AttentionBudgetError(
      `attention budget exceeded: estimated ${used} tokens >= ${Math.ceil(triggerTokens)} (triggerRatio ${compiler.triggerRatio} of inputCap ${compiler.inputCap}) after dropping ${droppedThinkingTurns} thinking turns and stubbing ${stubbedToolResults} tool results`,
    );
  }

  const mutated = droppedThinkingTurns > 0 || stubbedToolResults > 0;
  return {
    groups: mutated ? { ...groups, history, toolResults } : groups,
    mutated,
    report: {
      used: usedAtStart,
      usedAfter: Math.max(0, used),
      inputCap: compiler.inputCap,
      triggerRatio: compiler.triggerRatio,
      droppedThinkingTurns,
      stubbedToolResults,
      stubbedBytes,
      truncated: leftEligible > 0,
      ...(options.runId === undefined ? {} : { runId: options.runId }),
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    },
  };
}

/** Thinking-bearing assistant-message indexes, oldest first, excluding the newest `keepTurns`.
 *  Counts thinking turns, not assistant messages, so a thinking-free reply does not push an
 *  older reasoning block out of the keep window. */
function thinkingTargetIndexes(history: readonly Message[], keepTurns: number): number[] {
  const withThinking = history.flatMap((message, index) =>
    message.role === "assistant" && message.content.some((part) => part.type === "thinking") ? [index] : [],
  );
  return withThinking.slice(0, Math.max(0, withThinking.length - keepTurns));
}

/** Identity of one assistant turn's thinking, hashed so the frontier retains no model output. */
function thinkingKey(message: Message, redactor?: SecretRedactor): string {
  const text = message.content
    .flatMap((part) => (part.type === "thinking" ? [`${part.signature ?? ""}\u0000${part.text}`] : []))
    .join("\u0001");
  return digest(redactor?.redact(text) ?? text);
}

interface ToolResultTarget {
  /** The row as this turn received it; the compiler replaces the array slot, never the message. */
  readonly message: Message;
  readonly block: ToolResultContent;
  readonly toolCallId: string;
  readonly toolName: string;
  /** Turn the result belongs to; the host summarize receives it, and the age gate uses it. */
  readonly rowTurn: number;
  /** Writes the stubbed message back into the group this row came from. */
  readonly update: (message: Message) => void;
}

/** Rows beyond the newest `keepLast`, in oldest-first order, minus everything C6 protects. */
function toolResultTargets(options: {
  /** Mutable clones owned by this turn: `update` writes the stub into the caller's copy. */
  readonly history: Message[];
  readonly toolResults: Message[];
  readonly rowTurns: readonly number[];
  readonly turn: number;
  readonly compiler: AttentionCompiler;
  readonly fold?: ResolvedToolResultFoldOptions;
}): ToolResultTarget[] {
  const rows: ToolResultTarget[] = [];
  const add = (message: Message, rowTurn: number, update: (next: Message) => void) => {
    const block = toolResultBlock(message);
    if (!block) return;
    rows.push({ message, block, toolCallId: block.toolCallId, toolName: block.name, rowTurn, update });
  };
  for (let index = 0; index < options.history.length; index += 1) {
    const message = options.history[index];
    if (message) add(message, options.rowTurns[index] ?? options.turn, (next) => void (options.history[index] = next));
  }
  for (let index = 0; index < options.toolResults.length; index += 1) {
    const message = options.toolResults[index];
    if (message) add(message, options.turn, (next) => void (options.toolResults[index] = next));
  }

  const excluded = new Set(options.compiler.excludeTools);
  const keepFrom = Math.max(0, rows.length - options.compiler.keepLast);
  return rows.slice(0, keepFrom).filter((target) => {
    const { block, message } = target;
    if (block.error !== undefined && block.error !== null) return false;
    if (excluded.has(target.toolName)) return false;
    if (isProtectedToolResult(message.metadata)) return false;
    const fold = options.fold;
    if (!fold) return true;
    if (options.turn - target.rowTurn < fold.minAgeTurns) return false;
    return estimateTextBytes(toolResultFoldText(block.result, block.error, message.content)) >= fold.minBytes;
  });
}

async function stubToolResultMessage(target: ToolResultTarget, options: AttentionCompileOptions): Promise<Message> {
  const { block, message } = target;
  const text = toolResultFoldText(block.result, block.error, message.content);
  const fold = options.fold;
  const summary = fold
    ? capToolResultSummary(
        String(
          await fold.summarize({
            sessionId: options.sessionId ?? "",
            runId: options.runId ?? "",
            turn: target.rowTurn,
            toolCallId: target.toolCallId,
            toolName: target.toolName,
            text,
          }),
        ),
        fold.maxSummaryBytes,
      )
    : attentionStubText(options.redactor?.redact(text) ?? text);
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "tool_result" ? { ...part, result: foldedToolResultHeader(target.toolName, target.toolCallId, summary) } : part,
    ),
    metadata: { ...message.metadata, prismFolded: true },
  };
}

/** Deterministic default stub (C5): byte count plus a digest of the already-redacted text, so
 *  the model keeps a stable placeholder and never sees the payload again. */
function attentionStubText(redactedText: string): string {
  return `omitted ${estimateTextBytes(redactedText)} bytes (sha256 ${digest(redactedText)})`;
}

function toolResultBlock(message: Message) {
  const block = message.content.find((part) => part.type === "tool_result");
  return block?.type === "tool_result" ? block : undefined;
}

function isProtectedToolResult(metadata: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!metadata) return false;
  return PROTECTED_TOOL_RESULT_METADATA_KEYS.some((key) => metadata[key] !== undefined);
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, THINKING_KEY_BYTES);
}

/* ------------------------------------------------------------------------------------------------
 * Frontier hygiene, persistence, and the truncated-turn follow-up (plan 074, Further Actions)
 * ------------------------------------------------------------------------------------------------ */

/** Live and persisted frontier caps. Far above any realistic session (one entry per mutation),
 *  so eviction only ever drops mutations whose rows have long left the input window. */
const MAX_ATTENTION_THINKING_KEYS = 256;
const MAX_ATTENTION_TOOL_CALL_IDS = 256;
const MAX_ATTENTION_TOOL_CALL_ID_CHARS = 256;
const ATTENTION_STICKY_SCHEMA_VERSION = 1 as const;

/** Serialized sticky frontier (plan 074 P3). Hashes and tool-call ids only: no model output,
 *  no payload, nothing that needs redaction, so a durable resume can restore it verbatim. */
export interface PersistedAttentionStickyFrontier {
  readonly v: 1;
  /** Newest-last, so a restored frontier is the tail of the mutations the session made. */
  readonly thinking: readonly string[];
  readonly toolCallIds: readonly string[];
}

/** Keep the newest `max` keys: a session that runs long enough to overflow the cap should
 *  re-apply its recent mutations, not its oldest. */
function trimNewest(set: Set<string>, max: number): string[] {
  while (set.size > max) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
  return [...set];
}

/** Record one mutation, keeping the live frontier inside its cap. The evicted key is the
 *  oldest one, whose row has almost certainly left the input window; if it ever comes back the
 *  compiler re-decides (and the deterministic stub re-applies byte-identically when over). */
function rememberThinking(frontier: AttentionStickyFrontier | undefined, key: string): void {
  if (!frontier) return;
  frontier.thinking.add(key);
  trimNewest(frontier.thinking, MAX_ATTENTION_THINKING_KEYS);
}

function rememberToolCall(frontier: AttentionStickyFrontier | undefined, toolCallId: string): void {
  if (!frontier) return;
  frontier.toolCallIds.add(toolCallId);
  trimNewest(frontier.toolCallIds, MAX_ATTENTION_TOOL_CALL_IDS);
}

/** Bounded snapshot of a live frontier; caller-owned (the runtime persists it, the compiler
 *  never writes anywhere). */
export function serializeAttentionStickyFrontier(frontier: AttentionStickyFrontier): PersistedAttentionStickyFrontier {
  return {
    v: ATTENTION_STICKY_SCHEMA_VERSION,
    thinking: trimNewest(frontier.thinking, MAX_ATTENTION_THINKING_KEYS),
    toolCallIds: trimNewest(frontier.toolCallIds, MAX_ATTENTION_TOOL_CALL_IDS),
  };
}

const THINKING_KEY_PATTERN = /^[0-9a-f]{32}$/;

/** Validate a persisted frontier from an untrusted store (plan 074 P3). Malformed *entries* are
 *  dropped one by one — a key the compiler cannot trust simply re-decides on the next turn —
 *  while a malformed *shape* yields `undefined` so the caller starts from an empty frontier.
 *  Never throws: a resume must not fail because a checkpoint was hand-edited. */
export function parseAttentionStickyFrontier(value: unknown): PersistedAttentionStickyFrontier | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as { thinking?: unknown; toolCallIds?: unknown };
  if (!Array.isArray(record.thinking) || !Array.isArray(record.toolCallIds)) return undefined;
  const thinking = record.thinking.filter((key): key is string => typeof key === "string" && THINKING_KEY_PATTERN.test(key));
  const toolCallIds = record.toolCallIds.filter(
    (id): id is string =>
      typeof id === "string" && id.length > 0 && id.length <= MAX_ATTENTION_TOOL_CALL_ID_CHARS && !id.includes("\u0000"),
  );
  return {
    v: ATTENTION_STICKY_SCHEMA_VERSION,
    // The tail is the newest window; a long-lived checkpoint cannot grow past the live caps.
    thinking: thinking.slice(-MAX_ATTENTION_THINKING_KEYS),
    toolCallIds: toolCallIds.slice(-MAX_ATTENTION_TOOL_CALL_IDS),
  };
}

/** Rebuild a frontier from a restored snapshot; callers hold the session that owns it. */
export function restoreAttentionStickyFrontier(persisted: PersistedAttentionStickyFrontier): AttentionStickyFrontier {
  const frontier = createAttentionStickyFrontier();
  for (const key of persisted.thinking) frontier.thinking.add(key);
  for (const id of persisted.toolCallIds) frontier.toolCallIds.add(id);
  return frontier;
}

/** Consecutive `truncated` turns that arm compaction by default. */
export const DEFAULT_ATTENTION_TRUNCATION_THRESHOLD = 2;

export interface AttentionTruncationTriggerOptions {
  /** Truncated turns in a row before the trigger fires (default 2). */
  readonly threshold?: number;
}

/**
 * Host-side follow-up policy for `truncated` turns (plan 074 P4). `truncated: true` means the
 * gate ran out of *eligible* rows: stubs cannot hold the request under the ratio, so the honest
 * answer is a new prefix at the next task boundary rather than a silent eviction.
 *
 * Wire it by feeding every `attention_compiled` event to `observe` and handing `trigger` to
 * `CompactionOptions.trigger` (agent config or run options). It fires **once per armed streak**,
 * so a branch is compacted once and then left alone until new truncated turns arrive; a mutated
 * turn that was not truncated clears the streak because the pressure was relieved.
 */
export interface AttentionTruncationTrigger {
  /** Drop-in `CompactionOptions.trigger`. */
  readonly trigger: CompactionTrigger;
  /** Feed an `attention_compiled` event or an `AttentionReport`; returns the resulting streak. */
  observe(report: { readonly truncated?: unknown }): number;
  /** Truncated turns in a row since the last fire or relief. */
  readonly streak: () => number;
  /** Clear the streak (host compacted for its own reasons). */
  reset(): void;
}

export function createAttentionTruncationTrigger(options: AttentionTruncationTriggerOptions = {}): AttentionTruncationTrigger {
  const threshold = options.threshold ?? DEFAULT_ATTENTION_TRUNCATION_THRESHOLD;
  if (!Number.isSafeInteger(threshold) || threshold < 1) {
    throw new TypeError("attention truncation threshold must be a positive safe integer");
  }
  let streak = 0;
  return {
    trigger: {
      type: "custom",
      shouldCompact: () => {
        if (streak < threshold) return false;
        streak = 0;
        return true;
      },
    },
    observe: (report) => {
      streak = report.truncated === true ? streak + 1 : 0;
      return streak;
    },
    streak: () => streak,
    reset: () => {
      streak = 0;
    },
  };
}
