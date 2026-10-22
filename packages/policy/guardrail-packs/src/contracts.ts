/**
 * Guardrail packs (plan 092 Task 2; moved to `@arnilo/prism-guardrail-packs` in plan 159 Task 5):
 * config-declared, restrictive-only rule sets compiled once at package setup onto the `tool.call`
 * and `tool.result` seams. Packs can only deny, tripwire, or ask for approval — they never grant
 * permissions, widen arguments, or add a stage.
 */
import type { JsonObject } from "@arnilo/prism";

export type GuardrailRuleAction = "deny" | "tripwire" | "ask";

/** Read-only identity view handed to a pack rule predicate (never carries a raw argument echo). */
export interface GuardrailRuleContext {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Pack-local state shared with the pack's result observer; treat as read-only. */
  readonly state: Readonly<Record<string, unknown>>;
}

export interface GuardrailRule {
  readonly id: string;
  /** Tool names this rule applies to; omitted matches every tool. */
  readonly tool?: string | readonly string[];
  /** Regex source, compiled once; tested against matched argument strings. Exactly one of `pattern` / `deny`. */
  readonly pattern?: string | RegExp;
  /** Dot path(s) of arguments to test (e.g. `command`, `["from", "to"]`); omitted deep-scans argument strings. */
  readonly argPath?: string | readonly string[];
  /** Typed predicate escape hatch (host-trusted like all host code); deny when it returns true. Exactly one of `pattern` / `deny`. */
  readonly deny?: (args: JsonObject, context: GuardrailRuleContext) => boolean;
  /**
   * Defaults to `deny`. `tripwire` also rejects the enclosing run. `ask` suspends a durable run
   * before the call dispatches (the pending decision names this rule) and blocks the call in a run
   * that cannot suspend; it requires `pattern` — an opaque predicate cannot raise an approval
   * (plan 104 Task 3).
   */
  readonly action?: GuardrailRuleAction;
  /** Bounded, redacted record reason; defaults to the pack/rule id. */
  readonly reason?: string;
}

/** Built-in pack selection by `id` (optional `options`), or an inline pack when `rules` is present. */
export interface GuardrailPackInput {
  readonly id: string;
  readonly version?: number;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly rules?: readonly GuardrailRule[];
}

/** A session's `guardrailPacks` entry: built-in pack id, or an inline/built-in pack input object. */
export type GuardrailPackRef = string | GuardrailPackInput;
