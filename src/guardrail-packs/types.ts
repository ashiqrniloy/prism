/** Internal guardrail-pack definition types (plan 092 Task 2). Not SDK surface; hosts configure packs via `AgentSessionConfig.guardrailPacks`. */
import type { GuardrailRule, GuardrailRuleContext } from "../contracts-core/guardrail-packs.js";
import type { ToolResult } from "../contracts-protocol.js";

/** What a pack's `build` returns: restrictive rules plus an optional pure result observer. */
export interface GuardrailPackRules {
  readonly rules: readonly GuardrailRule[];
  /** Records tool results into pack-local state (never denies); a throw fails closed as a guardrail tripwire. */
  readonly observe?: (state: Record<string, unknown>, result: ToolResult, context: GuardrailRuleContext) => void;
}

export interface GuardrailPackDefinition {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  /** Pure factory: options in, rules out. No session access, no I/O. */
  readonly build: (options: Readonly<Record<string, unknown>>) => GuardrailPackRules;
}
