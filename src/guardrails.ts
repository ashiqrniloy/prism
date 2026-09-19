import type {
  AgentEvent,
  Guardrail,
  GuardrailAction,
  GuardrailContext,
  GuardrailPackInput,
  GuardrailPackRef,
  GuardrailRecord,
  GuardrailRule,
  GuardrailRuleAction,
  GuardrailRuleContext,
  GuardrailStage,
  Guardrails,
  GuardrailValue,
  JsonObject,
  ToolResult,
} from "./contracts.js";
import { GuardrailPackError } from "./guardrail-packs/errors.js";
export { GuardrailPackError } from "./guardrail-packs/errors.js";
import { BUILT_IN_GUARDRAIL_PACKS } from "./guardrail-packs/index.js";
import type { GuardrailPackRules } from "./guardrail-packs/types.js";
import type { SecretRedactor } from "./redaction.js";

export const MAX_GUARDRAIL_CONCURRENCY = 16;
const MAX_REASON_BYTES = 4 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;

/** Guardrail pack compile bounds (plan 092 Task 2). All ceilings are config-shape limits, not runtime budgets. */
export const MAX_GUARDRAIL_PACKS = 8;
export const MAX_GUARDRAIL_PACK_RULES = 64;
const MAX_PACK_ID_BYTES = 96;
const MAX_RULE_ID_BYTES = 96;
const MAX_RULE_REASON_BYTES = 512;
const MAX_RULE_ARG_PATHS = 8;
const MAX_PATTERN_BYTES = 4 * 1024;
const MAX_ARG_SCAN_DEPTH = 8;
const MAX_ARG_SCAN_STRINGS = 64;
const MAX_ARG_STRING_BYTES = 16 * 1024;
const MAX_PACK_NAME_BYTES = 128;
const OBSERVE_RULE_ID = "observe";

export class GuardrailError extends Error {
  readonly code: string;
  readonly record: GuardrailRecord;

  constructor(record: GuardrailRecord) {
    super(
      record.action === "interrupt"
        ? `Guardrail interruption is unavailable at stage "${record.stage}"; interrupt suspends only at the input stage of durable runs`
        : "Guardrail blocked run",
    );
    this.name = "GuardrailError";
    this.code = record.action === "interrupt" ? "ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE" : "ERR_PRISM_GUARDRAIL_BLOCKED";
    this.record = record;
  }
}

export interface RunGuardrailsOptions<S extends GuardrailStage> {
  readonly stage: S;
  readonly guardrails?: Guardrails;
  readonly value: GuardrailValue<S>;
  readonly context: Omit<GuardrailContext<S>, "stage" | "value" | "signal"> & { readonly signal?: AbortSignal };
  readonly redactor?: SecretRedactor;
  readonly emit?: (event: AgentEvent) => void | Promise<void>;
}

export interface GuardrailRunResult {
  readonly records: readonly GuardrailRecord[];
  readonly terminal?: GuardrailRecord;
}

/** Evaluate one typed stage. Default is declaration-order sequential; bounded parallel mode still reports declaration order. */
export async function runGuardrails<S extends GuardrailStage>(options: RunGuardrailsOptions<S>): Promise<GuardrailRunResult> {
  const guards = stageGuards(options.guardrails, options.stage);
  if (guards.length === 0) return { records: [] };
  const maxConcurrency = resolveConcurrency(options.guardrails?.maxConcurrency);
  const controller = new AbortController();
  const signal = options.context.signal ? AbortSignal.any([options.context.signal, controller.signal]) : controller.signal;
  const records: (GuardrailRecord | undefined)[] = new Array(guards.length);
  let next = 0;
  let stopped = false;

  const worker = async () => {
    for (;;) {
      if (stopped) return;
      const index = next++;
      if (index >= guards.length) return;
      const record = await evaluate(guards[index]!, options, signal);
      // A sibling may have reached a terminal decision while this callback was settling.
      if (stopped) return;
      records[index] = record;
      if (record.action !== "allow") {
        stopped = true;
        controller.abort(new GuardrailError(record));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, guards.length) }, worker));

  const normalized = records.filter((record): record is GuardrailRecord => record !== undefined);
  for (const record of normalized) {
    await options.emit?.({
      type: "guardrail_decision",
      sessionId: options.context.sessionId,
      runId: options.context.runId,
      toolCallId: options.context.toolCallId,
      toolName: options.context.toolName,
      record,
    });
  }
  return { records: normalized, terminal: normalized.find((record) => record.action !== "allow") };
}

export function assertGuardrailsAllowed(result: GuardrailRunResult): void {
  if (result.terminal) throw new GuardrailError(result.terminal);
}

/** One `guardrail:<stage>` identity row of a compiled pack, for run-bundle fingerprints. */
export interface GuardrailPackRow {
  readonly name: string;
  readonly stage: "tool_input" | "tool_output";
  readonly revision: string | null;
}

interface ResolvedRule {
  readonly rule: GuardrailRule;
  readonly action: GuardrailRuleAction;
  readonly reason: string;
  readonly tools?: readonly string[];
  readonly regex?: RegExp;
}

interface ResolvedPack {
  readonly id: string;
  readonly version: number;
  readonly rules: readonly ResolvedRule[];
  readonly observe?: GuardrailPackRules["observe"];
}

/**
 * Compiles `guardrailPacks` config onto the existing tool interception seams: one `tool_input`
 * guardrail per rule (`name = pack:<pack>/<rule>`), plus one `tool_output` recorder for packs that
 * observe results. Compiled once per session — patterns are compiled here, never per tool call.
 * Throws `GuardrailPackError` on malformed config (fail closed); returns `undefined` when unset.
 */
export function compileGuardrailPacks(
  refs: readonly GuardrailPackRef[] | undefined,
  registry: ReadonlyMap<string, import("./guardrail-packs/types.js").GuardrailPackDefinition> = BUILT_IN_GUARDRAIL_PACKS,
): Guardrails | undefined {
  const packs = resolveGuardrailPacks(refs, registry);
  if (packs.length === 0) return undefined;
  const toolInput: Guardrail<"tool_input">[] = [];
  const toolOutput: Guardrail<"tool_output">[] = [];
  for (const pack of packs) {
    const state: Record<string, unknown> = {};
    if (pack.observe) toolOutput.push(observeGuardrail(pack, pack.observe, state));
    for (const resolved of pack.rules) toolInput.push(ruleGuardrail(pack, resolved, state));
  }
  return toolOutput.length > 0 ? { toolInput, toolOutput } : { toolInput };
}

/** Stable identity rows for the same config `compileGuardrailPacks` accepts (no state, no guardrails built). */
export function describeGuardrailPacks(
  refs: readonly GuardrailPackRef[] | undefined,
  registry: ReadonlyMap<string, import("./guardrail-packs/types.js").GuardrailPackDefinition> = BUILT_IN_GUARDRAIL_PACKS,
): readonly GuardrailPackRow[] {
  const rows: GuardrailPackRow[] = [];
  for (const pack of resolveGuardrailPacks(refs, registry)) {
    if (pack.observe) rows.push({ name: packRuleName(pack.id, OBSERVE_RULE_ID), stage: "tool_output", revision: packRevision(pack) });
    for (const resolved of pack.rules)
      rows.push({ name: packRuleName(pack.id, resolved.rule.id), stage: "tool_input", revision: packRevision(pack) });
  }
  return rows;
}

function packRevision(pack: ResolvedPack): string {
  return `${pack.id}@${pack.version}`;
}

function packRuleName(packId: string, ruleId: string): string {
  return `pack:${packId}/${ruleId}`;
}

function resolveGuardrailPacks(
  refs: readonly GuardrailPackRef[] | undefined,
  registry: ReadonlyMap<string, import("./guardrail-packs/types.js").GuardrailPackDefinition>,
): readonly ResolvedPack[] {
  if (refs === undefined) return [];
  if (!Array.isArray(refs)) throw new GuardrailPackError("guardrailPacks must be an array of pack ids or pack input objects");
  if (refs.length > MAX_GUARDRAIL_PACKS) throw new GuardrailPackError(`guardrailPacks accepts at most ${MAX_GUARDRAIL_PACKS} packs`);
  const seenPacks = new Set<string>();
  return refs.map((ref) => {
    const input: GuardrailPackInput = (typeof ref === "string" ? { id: ref } : ref) ?? {};
    if (typeof input.id !== "string" || !input.id.trim() || byteLength(input.id) > MAX_PACK_ID_BYTES) {
      throw new GuardrailPackError(`guardrail pack ids must be non-empty strings of at most ${MAX_PACK_ID_BYTES} bytes`);
    }
    if (seenPacks.has(input.id)) throw new GuardrailPackError(`duplicate guardrail pack id "${input.id}"`);
    seenPacks.add(input.id);
    if (input.version !== undefined && (!Number.isSafeInteger(input.version) || input.version < 1)) {
      throw new GuardrailPackError(`guardrail pack "${input.id}" version must be a positive integer`);
    }
    const definition = registry.get(input.id);
    if (definition === undefined && input.rules === undefined) {
      throw new GuardrailPackError(`unknown guardrail pack "${input.id}"; known packs: ${[...registry.keys()].join(", ") || "none"}`);
    }
    let built: GuardrailPackRules;
    if (input.rules !== undefined) {
      if (input.options !== undefined) throw new GuardrailPackError(`inline guardrail pack "${input.id}" cannot set options`);
      built = { rules: input.rules };
    } else {
      built = definition!.build(Object.freeze({ ...input.options }));
    }
    if (!built || !Array.isArray(built.rules) || built.rules.length === 0) {
      throw new GuardrailPackError(`guardrail pack "${input.id}" must declare at least one rule`);
    }
    if (built.rules.length > MAX_GUARDRAIL_PACK_RULES) {
      throw new GuardrailPackError(`guardrail pack "${input.id}" accepts at most ${MAX_GUARDRAIL_PACK_RULES} rules`);
    }
    if (built.observe !== undefined && typeof built.observe !== "function") {
      throw new GuardrailPackError(`guardrail pack "${input.id}" observe must be a function`);
    }
    const seenRules = new Set<string>();
    const rules = built.rules.map((rule) => resolveRule(input.id, rule, seenRules));
    if (built.observe && byteLength(packRuleName(input.id, OBSERVE_RULE_ID)) > MAX_PACK_NAME_BYTES) {
      throw new GuardrailPackError(`guardrail pack "${input.id}" name exceeds ${MAX_PACK_NAME_BYTES} bytes`);
    }
    return {
      id: input.id,
      version: input.version ?? definition?.version ?? 1,
      rules,
      ...(built.observe ? { observe: built.observe } : {}),
    };
  });
}

function resolveRule(packId: string, rule: GuardrailRule, seenRules: Set<string>): ResolvedRule {
  const where = `guardrail pack "${packId}"`;
  if (!rule || typeof rule.id !== "string" || !rule.id.trim() || byteLength(rule.id) > MAX_RULE_ID_BYTES) {
    throw new GuardrailPackError(`${where} rule ids must be non-empty strings of at most ${MAX_RULE_ID_BYTES} bytes`);
  }
  if (seenRules.has(rule.id)) throw new GuardrailPackError(`${where} has a duplicate rule id "${rule.id}"`);
  seenRules.add(rule.id);
  const action = rule.action ?? "deny";
  if (action !== "deny" && action !== "tripwire") {
    throw new GuardrailPackError(`${where} rule "${rule.id}" action must be "deny" or "tripwire" ("ask" has no deterministic seam)`);
  }
  const hasPattern = rule.pattern !== undefined;
  const hasDeny = rule.deny !== undefined;
  if (hasPattern === hasDeny) {
    throw new GuardrailPackError(`${where} rule "${rule.id}" requires exactly one of "pattern" or "deny"`);
  }
  if (hasDeny && typeof rule.deny !== "function") throw new GuardrailPackError(`${where} rule "${rule.id}" deny must be a function`);
  if (rule.reason !== undefined && (typeof rule.reason !== "string" || byteLength(rule.reason) > MAX_RULE_REASON_BYTES)) {
    throw new GuardrailPackError(`${where} rule "${rule.id}" reason must be a string of at most ${MAX_RULE_REASON_BYTES} bytes`);
  }
  let tools: readonly string[] | undefined;
  if (rule.tool !== undefined) {
    tools = typeof rule.tool === "string" ? [rule.tool] : [...rule.tool];
    if (tools.length === 0 || tools.length > MAX_GUARDRAIL_PACK_RULES || tools.some((name) => typeof name !== "string" || !name.trim())) {
      throw new GuardrailPackError(`${where} rule "${rule.id}" tool must be a non-empty tool name or array of names`);
    }
  }
  if (rule.argPath !== undefined) {
    const paths = typeof rule.argPath === "string" ? [rule.argPath] : [...rule.argPath];
    if (paths.length === 0 || paths.length > MAX_RULE_ARG_PATHS || paths.some((path) => typeof path !== "string" || !path.trim())) {
      throw new GuardrailPackError(`${where} rule "${rule.id}" argPath must be a non-empty dot path or array of paths`);
    }
  }
  if (byteLength(packRuleName(packId, rule.id)) > MAX_PACK_NAME_BYTES) {
    throw new GuardrailPackError(`${where} rule "${rule.id}" name exceeds ${MAX_PACK_NAME_BYTES} bytes`);
  }
  return {
    rule,
    action,
    reason: rule.reason ?? `guardrail pack rule ${packId}/${rule.id}`,
    ...(tools ? { tools } : {}),
    ...(hasPattern ? { regex: compileRulePattern(packId, rule.id, rule.pattern) } : {}),
  };
}

function compileRulePattern(packId: string, ruleId: string, pattern: string | RegExp): RegExp {
  const where = `guardrail pack "${packId}" rule "${ruleId}"`;
  if (pattern instanceof RegExp) return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
  if (typeof pattern !== "string" || !pattern) throw new GuardrailPackError(`${where} pattern must be a non-empty string or RegExp`);
  if (byteLength(pattern) > MAX_PATTERN_BYTES) throw new GuardrailPackError(`${where} pattern exceeds ${MAX_PATTERN_BYTES} bytes`);
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new GuardrailPackError(`${where} has an invalid pattern`, { cause: error });
  }
}

function ruleGuardrail(pack: ResolvedPack, resolved: ResolvedRule, state: Record<string, unknown>): Guardrail<"tool_input"> {
  return {
    name: packRuleName(pack.id, resolved.rule.id),
    revision: packRevision(pack),
    stage: "tool_input",
    evaluate(context) {
      if (resolved.tools && !resolved.tools.includes(context.toolName ?? "")) return { action: "allow" };
      const args = context.value.arguments;
      const matched = resolved.rule.deny
        ? Boolean(resolved.rule.deny(args, ruleContext(context, state)))
        : patternMatches(resolved.regex!, argumentStrings(args, resolved.rule.argPath));
      if (!matched) return { action: "allow" };
      return {
        // Pack vocabulary is `deny`; the core guardrail action for a denial is `block`.
        action: resolved.action === "deny" ? "block" : "tripwire",
        reason: resolved.reason,
        metadata: { pack: pack.id, rule: resolved.rule.id, version: pack.version },
      };
    },
  };
}

function observeGuardrail(
  pack: ResolvedPack,
  observe: NonNullable<GuardrailPackRules["observe"]>,
  state: Record<string, unknown>,
): Guardrail<"tool_output"> {
  return {
    name: packRuleName(pack.id, OBSERVE_RULE_ID),
    revision: packRevision(pack),
    stage: "tool_output",
    evaluate(context) {
      observe(state, context.value as ToolResult, ruleContext(context, state));
      return { action: "allow" };
    },
  };
}

function ruleContext(
  context: {
    readonly toolName?: string;
    readonly toolCallId?: string;
    readonly sessionId: string;
    readonly runId: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  },
  state: Record<string, unknown>,
): GuardrailRuleContext {
  return {
    toolName: context.toolName ?? "",
    toolCallId: context.toolCallId ?? "",
    sessionId: context.sessionId,
    runId: context.runId,
    metadata: context.metadata,
    state,
  };
}

function patternMatches(regex: RegExp, values: readonly string[]): boolean {
  for (const value of values) {
    if (regex.test(value.length > MAX_ARG_STRING_BYTES ? value.slice(0, MAX_ARG_STRING_BYTES) : value)) return true;
  }
  return false;
}

function argumentStrings(args: JsonObject, argPath: string | readonly string[] | undefined): readonly string[] {
  if (argPath === undefined) {
    const all: string[] = [];
    for (const value of Object.values(args)) pushStrings(value, all, 0);
    return all;
  }
  const out: string[] = [];
  for (const path of typeof argPath === "string" ? [argPath] : argPath) {
    walkPath(args, path.split("."), out);
    if (out.length >= MAX_ARG_SCAN_STRINGS) break;
  }
  return out;
}

function walkPath(value: unknown, segments: readonly string[], out: string[]): void {
  if (out.length >= MAX_ARG_SCAN_STRINGS) return;
  if (segments.length === 0) {
    pushStrings(value, out, 0);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkPath(item, segments, out);
    return;
  }
  if (value && typeof value === "object") {
    walkPath((value as Record<string, unknown>)[segments[0]!], segments.slice(1), out);
  }
}

function pushStrings(value: unknown, out: string[], depth: number): void {
  if (out.length >= MAX_ARG_SCAN_STRINGS || depth > MAX_ARG_SCAN_DEPTH) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) pushStrings(item, out, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) pushStrings(item, out, depth + 1);
  }
}

function stageGuards<S extends GuardrailStage>(guardrails: Guardrails | undefined, stage: S): readonly Guardrail<S>[] {
  if (!guardrails) return [];
  switch (stage) {
    case "input":
      return (guardrails.input ?? []) as readonly Guardrail<S>[];
    case "output":
      return (guardrails.output ?? []) as readonly Guardrail<S>[];
    case "tool_input":
      return (guardrails.toolInput ?? []) as readonly Guardrail<S>[];
    case "tool_output":
      return (guardrails.toolOutput ?? []) as readonly Guardrail<S>[];
  }
}

async function evaluate<S extends GuardrailStage>(
  guardrail: Guardrail<S>,
  options: RunGuardrailsOptions<S>,
  signal: AbortSignal,
): Promise<GuardrailRecord> {
  if (
    !guardrail ||
    typeof guardrail.name !== "string" ||
    !guardrail.name ||
    guardrail.name.length > 128 ||
    guardrail.stage !== options.stage ||
    typeof guardrail.evaluate !== "function"
  ) {
    return record(guardrail?.name ?? "invalid", options.stage, "tripwire", "guardrail_invalid", undefined, options.redactor);
  }
  try {
    const decision = await guardrail.evaluate({ ...options.context, stage: options.stage, value: options.value, signal });
    if (!decision || !isAction(decision.action)) {
      return record(guardrail.name, options.stage, "tripwire", "guardrail_invalid_decision", undefined, options.redactor);
    }
    return record(guardrail.name, options.stage, decision.action, decision.reason, decision.metadata, options.redactor);
  } catch (error) {
    // Keep the cause diagnosable without leaking internals: message only, bounded and
    // passed through the same redact+bound metadata path as guardrail-provided metadata.
    const message = error instanceof Error ? error.message : String(error);
    const redacted = options.redactor?.redact(message) ?? message;
    return record(
      guardrail.name,
      options.stage,
      "tripwire",
      "guardrail_failed",
      { error: boundText(redacted, MAX_REASON_BYTES) },
      options.redactor,
    );
  }
}

function resolveConcurrency(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_GUARDRAIL_CONCURRENCY) {
    throw new Error(`Guardrail maxConcurrency must be a safe integer from 1 to ${MAX_GUARDRAIL_CONCURRENCY}`);
  }
  return value;
}

function isAction(value: unknown): value is GuardrailAction {
  return value === "allow" || value === "block" || value === "tripwire" || value === "interrupt";
}

function record(
  guardrail: string,
  stage: GuardrailStage,
  action: GuardrailAction,
  reason: unknown,
  metadata: unknown,
  redactor: SecretRedactor | undefined,
): GuardrailRecord {
  return {
    guardrail: boundText(guardrail, 128) || "invalid",
    stage,
    action,
    reason: typeof reason === "string" ? boundText(redactor?.redact(reason) ?? reason, MAX_REASON_BYTES) : undefined,
    metadata: boundedMetadata(metadata, redactor),
  };
}

function boundedMetadata(value: unknown, redactor: SecretRedactor | undefined): Readonly<Record<string, unknown>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const json = JSON.stringify(redactor?.redact(value) ?? value);
    if (!json || byteLength(json) > MAX_METADATA_BYTES) return { truncated: true };
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Readonly<Record<string, unknown>>) : undefined;
  } catch {
    return { invalid: true };
  }
}

function boundText(value: string, limit: number): string {
  const bytes = new TextEncoder().encode(value);
  return bytes.length <= limit ? value : new TextDecoder().decode(bytes.subarray(0, limit));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
