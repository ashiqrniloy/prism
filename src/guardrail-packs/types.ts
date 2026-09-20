/** Internal guardrail-pack definition types (plan 092 Task 2). Not SDK surface; hosts configure packs via `AgentSessionConfig.guardrailPacks`. */
import type { GuardrailRule, GuardrailRuleContext } from "../contracts-core/guardrail-packs.js";
import type { ToolResult } from "../contracts-protocol.js";

/** Plan 104 Task 2: pack-owned durable-state codec. The pack decides what a checkpoint carries. */
interface GuardrailPackStateCodec {
  /** Serialize the live state for a checkpoint; `undefined` when nothing needs persisting. */
  readonly snapshot: (state: Record<string, unknown>) => Readonly<Record<string, unknown>> | undefined;
  /** Parse a persisted snapshot back into state fields; throw `GuardrailPackError` on a malformed value. */
  readonly parse: (json: unknown) => Record<string, unknown>;
}

/** What a pack's `build` returns: restrictive rules plus an optional pure result observer. */
export interface GuardrailPackRules {
  readonly rules: readonly GuardrailRule[];
  /** Records tool results into pack-local state (never denies); a throw fails closed as a guardrail tripwire. */
  readonly observe?: (state: Record<string, unknown>, result: ToolResult, context: GuardrailRuleContext) => void;
  /** Optional codec making the pack's state survive a durable resume; a pack without one persists nothing. */
  readonly state?: GuardrailPackStateCodec;
}

export interface GuardrailPackDefinition {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  /** Pure factory: options in, rules out. No session access, no I/O. */
  readonly build: (options: Readonly<Record<string, unknown>>) => GuardrailPackRules;
}
