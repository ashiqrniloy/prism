/**
 * Guardrail-pack compile + evaluation (moved from the kernel's `src/guardrails.ts` in plan 159 Task 5).
 *
 * The kernel no longer compiles packs: this module validates the config once, builds one restrictive
 * guardrail per rule, and runs them over the kernel's shared stage runner
 * (`runGuardrailList`, still in `@arnilo/prism` for `field-evidence.ts`).
 */
import type { Guardrail, JsonObject, ToolResult } from "@arnilo/prism";
import { GuardrailError, guardrailRefusalText, runGuardrailList } from "@arnilo/prism";
import type { GuardrailPackInput, GuardrailPackRef, GuardrailRule, GuardrailRuleAction, GuardrailRuleContext } from "./contracts.js";
import { GuardrailPackError } from "./packs/errors.js";
import { BUILT_IN_GUARDRAIL_PACKS } from "./packs/index.js";
import type { GuardrailPackRules } from "./packs/types.js";

export type { GuardrailRunResult, RunGuardrailListOptions } from "@arnilo/prism";
export { GuardrailPackError } from "./packs/errors.js";
export { GuardrailError, guardrailRefusalText, runGuardrailList };

/** The `package.event` owner stamped on every emitted `guardrail.decision`. */
export const GUARDRAIL_PACKS_PACKAGE = "@arnilo/prism-guardrail-packs";

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

/** One `guardrail:<stage>` identity row of a compiled pack, for `guardrail-packs:describe`. */
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

/** A validated pack: pure data plus compiled patterns and the pack-owned state codec. */
export interface ResolvedPack {
  readonly id: string;
  readonly version: number;
  readonly rules: readonly ResolvedRule[];
  readonly observe?: GuardrailPackRules["observe"];
  /** Live pack-local state record shared by this pack's rules and observer. */
  readonly state: Record<string, unknown>;
  readonly stateCodec?: NonNullable<GuardrailPackRules["state"]>;
  /** Inline-rule packs cannot be replayed from a checkpoint and refuse to snapshot. */
  readonly inline: boolean;
}

/** Stable identity rows for the config `resolveGuardrailPacks` accepts (no state, no guardrails built). */
export function describeGuardrailPacks(
  refs: readonly GuardrailPackRef[] | undefined,
  registry: ReadonlyMap<string, import("./packs/types.js").GuardrailPackDefinition> = BUILT_IN_GUARDRAIL_PACKS,
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

/**
 * Validates `packs` config into pure, compiled pack definitions (fail closed). Called once in
 * `setup`; a malformed pack throws `GuardrailPackError`, so `createAgent` fails and names the package.
 */
export function resolveGuardrailPacks(
  refs: readonly GuardrailPackRef[] | undefined,
  registry: ReadonlyMap<string, import("./packs/types.js").GuardrailPackDefinition> = BUILT_IN_GUARDRAIL_PACKS,
): readonly ResolvedPack[] {
  if (refs === undefined) return [];
  if (!Array.isArray(refs)) throw new GuardrailPackError("guardrail packs must be an array of pack ids or pack input objects");
  if (refs.length > MAX_GUARDRAIL_PACKS) throw new GuardrailPackError(`guardrail packs accept at most ${MAX_GUARDRAIL_PACKS} packs`);
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
      throw unknownGuardrailPack(input.id, registry);
    }
    let built: GuardrailPackRules;
    if (input.rules !== undefined) {
      if (input.options !== undefined) throw new GuardrailPackError(`inline guardrail pack "${input.id}" cannot set options`);
      built = { rules: input.rules };
    } else {
      if (definition === undefined) throw unknownGuardrailPack(input.id, registry);
      built = definition.build(Object.freeze({ ...input.options }));
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
    if (built.state !== undefined && (typeof built.state.snapshot !== "function" || typeof built.state.parse !== "function")) {
      throw new GuardrailPackError(`guardrail pack "${input.id}" state codec must declare snapshot and parse`);
    }
    const seenRules = new Set<string>();
    const rules = built.rules.map((rule) => resolveRule(input.id, rule, seenRules));
    if (built.observe && byteLength(packRuleName(input.id, OBSERVE_RULE_ID)) > MAX_PACK_NAME_BYTES) {
      throw new GuardrailPackError(`guardrail pack "${input.id}" name exceeds ${MAX_PACK_NAME_BYTES} bytes`);
    }
    const version = input.version ?? definition?.version ?? 1;
    return {
      id: input.id,
      version,
      rules,
      state: {},
      inline: input.rules !== undefined,
      ...(built.observe ? { observe: built.observe } : {}),
      ...(built.state !== undefined ? { stateCodec: built.state } : {}),
    };
  });
}

function unknownGuardrailPack(id: string, registry: ReadonlyMap<string, unknown>): GuardrailPackError {
  return new GuardrailPackError(`unknown guardrail pack "${id}"; known packs: ${[...registry.keys()].join(", ") || "none"}`);
}

function resolveRule(packId: string, rule: GuardrailRule, seenRules: Set<string>): ResolvedRule {
  const where = `guardrail pack "${packId}"`;
  if (!rule || typeof rule.id !== "string" || !rule.id.trim() || byteLength(rule.id) > MAX_RULE_ID_BYTES) {
    throw new GuardrailPackError(`${where} rule ids must be non-empty strings of at most ${MAX_RULE_ID_BYTES} bytes`);
  }
  if (seenRules.has(rule.id)) throw new GuardrailPackError(`${where} has a duplicate rule id "${rule.id}"`);
  seenRules.add(rule.id);
  const action = rule.action ?? "deny";
  if (action !== "deny" && action !== "tripwire" && action !== "ask") {
    throw new GuardrailPackError(`${where} rule "${rule.id}" action must be "deny", "tripwire", or "ask"`);
  }
  if (action === "ask" && rule.deny !== undefined) {
    throw new GuardrailPackError(
      `${where} rule "${rule.id}" action "ask" requires "pattern": an opaque deny predicate cannot raise an approval`,
    );
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

/**
 * One `tool_input` guardrail per rule. `deny` maps to the core `block`, `ask` to `interrupt` (the
 * kernel turns it into an inline confirm or a suspension), and `tripwire` to `tripwire`.
 */
export function ruleGuardrail(pack: ResolvedPack, resolved: ResolvedRule, state: Record<string, unknown>): Guardrail<"tool_input"> {
  return {
    name: packRuleName(pack.id, resolved.rule.id),
    revision: packRevision(pack),
    stage: "tool_input",
    evaluate(context) {
      if (resolved.tools && !resolved.tools.includes(context.toolName ?? "")) return { action: "allow" };
      const args = context.value.arguments;
      const matched = resolved.rule.deny
        ? Boolean(resolved.rule.deny(args, ruleContext(context, state)))
        : resolved.regex !== undefined && patternMatches(resolved.regex, argumentStrings(args, resolved.rule.argPath));
      if (!matched) return { action: "allow" };
      return {
        // Pack vocabulary is `deny`/`ask`; the core guardrail actions are `block`/`interrupt`.
        action: resolved.action === "deny" ? "block" : resolved.action === "ask" ? "interrupt" : "tripwire",
        reason: resolved.reason,
        metadata: { pack: pack.id, rule: resolved.rule.id, version: pack.version },
      };
    },
  };
}

/** The pack's result observer as a `tool_output` guardrail; it never denies. */
export function observeGuardrail(
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

/** The pack-owned state snapshot for `state.session("packs", …)`; `undefined` when nothing needs persisting. */
export function snapshotPackState(
  packs: readonly ResolvedPack[],
  stateByPack: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, Readonly<Record<string, unknown>>> | undefined {
  const state: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const pack of packs) {
    const live = stateByPack.get(pack.id);
    if (live === undefined) continue;
    // Plan 104 T3: an inline pack cannot persist a `deny` predicate or a `RegExp` pattern (a closure
    // has no JSON form; a `RegExp` serializes to `{}`, which would restore as an absent pattern).
    const unpersistable = pack.inline
      ? pack.rules.find((resolved) => resolved.rule.deny !== undefined || resolved.rule.pattern instanceof RegExp)
      : undefined;
    if (unpersistable) {
      throw new GuardrailPackError(
        `guardrail pack "${pack.id}" rule "${unpersistable.rule.id}" cannot be persisted (deny predicate or RegExp pattern); use a pattern string or a registered pack id`,
      );
    }
    const snapshot = pack.stateCodec?.snapshot(live);
    if (snapshot !== undefined) state[pack.id] = snapshot;
  }
  return Object.keys(state).length > 0 ? state : undefined;
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
    const segment = segments[0];
    if (segment === undefined) return;
    walkPath((value as Record<string, unknown>)[segment], segments.slice(1), out);
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

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
