/**
 * Guardrail packs (plan 092 Task 2; moved to `@arnilo/prism-extensions/guardrail-packs` in plan 159 Task 5;
 * content stages in plan 237 Task 2): config-declared, restrictive-only rule sets compiled once at
 * package setup. A tool-call rule runs on `tool.call` and can deny, tripwire, or ask. A content rule
 * names a stage (`input` on `run.input`, `output` on `model.response`, `tool_result` on `tool.result`)
 * and can deny, redact, or flag. A rule only removes or refuses content: it never grants a
 * permission, widens arguments, or adds content.
 */
import type { JsonObject } from "@arnilo/prism";
import type { GuardrailJudge } from "./judge.js";

export type { GuardrailJudge } from "./judge.js";

/** `tripwire` and `ask` apply to tool-call rules only; `redact` and `flag` to content rules only. */
export type GuardrailRuleAction = "deny" | "tripwire" | "ask" | "redact" | "flag";

/** Where a rule runs. `tool_call` (the default) is the `tool.call` gate; the rest are content stages. */
export type GuardrailRuleStage = "tool_call" | "input" | "output" | "tool_result";

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
  /** Defaults to `tool_call`. A content stage takes a `pattern` or a `detector`, never `deny` or `argPath`. */
  readonly stage?: GuardrailRuleStage;
  /** Tool names this rule applies to (`tool_call` and `tool_result` only); omitted matches every tool. */
  readonly tool?: string | readonly string[];
  /**
   * Regex source, compiled once. On `tool_call` it is tested against argument strings; on a content
   * stage it is matched across text. Exactly one of `pattern` / `deny` / `detector` / `judge`.
   */
  readonly pattern?: string | RegExp;
  /**
   * Content stages only (plan 237 Task 3): ask a model one yes/no question about the item instead of
   * matching a pattern. Action `deny` or `flag`. Needs the `models` capability, which the package
   * declares only when a judge rule is configured; one model call per item, cached per run.
   */
  readonly judge?: GuardrailJudge;
  /** Content stages only: built-in detector name(s), e.g. `email`, `payment-card`, `instruction-override`. */
  readonly detector?: string | readonly string[];
  /** Dot path(s) of arguments to test (e.g. `command`, `["from", "to"]`); omitted deep-scans argument strings. */
  readonly argPath?: string | readonly string[];
  /** Typed predicate escape hatch (host-trusted like all host code); deny when it returns true. `tool_call` only. */
  readonly deny?: (args: JsonObject, context: GuardrailRuleContext) => boolean;
  /**
   * `tool_result` only: scan only results marked `metadata.trust: "untrusted_external"`, plus results
   * of the tools named in `alsoScanTools`.
   */
  readonly untrustedOnly?: boolean;
  /** `tool_result` with `untrustedOnly` only: tools scanned whatever their trust marking (at most 16). */
  readonly alsoScanTools?: readonly string[];
  /**
   * Defaults to `deny`. On `tool_call`: `tripwire` also rejects the enclosing run, and `ask` suspends a
   * durable run before the call dispatches (the pending decision names this rule) and blocks the call
   * in a run that cannot suspend; it requires `pattern` — an opaque predicate cannot raise an approval
   * (plan 104 Task 3). On a content stage: `deny` refuses the content (the run fails, a steer is
   * dropped, or a tool result becomes an error), `redact` replaces each match with
   * `[redacted:<rule id>]`, and `flag` only records the decision.
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
