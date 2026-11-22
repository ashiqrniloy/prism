/** Option readers shared by the content packs (plan 237 Task 2). Unknown keys and bad values fail closed. */

import type { ContentAction, ContentStage } from "../content.js";
import type { GuardrailRuleAction } from "../contracts.js";
import { GuardrailPackError } from "./errors.js";

export function assertKnownOptions(pack: string, options: Readonly<Record<string, unknown>>, known: readonly string[]): void {
  for (const key of Object.keys(options)) {
    if (!known.includes(key)) throw new GuardrailPackError(`${pack} has unknown option "${key}"; known options: ${known.join(", ")}`);
  }
}

export function readSubset<T extends string>(
  pack: string,
  key: string,
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[],
): readonly T[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length === 0 || value.length > allowed.length) {
    throw new GuardrailPackError(`${pack} options.${key} must be a non-empty array of: ${allowed.join(", ")}`);
  }
  const out: T[] = [];
  for (const item of value) {
    if (!allowed.includes(item as T))
      throw new GuardrailPackError(`${pack} options.${key} has unknown value "${String(item)}"; allowed: ${allowed.join(", ")}`);
    if (!out.includes(item as T)) out.push(item as T);
  }
  return out;
}

export function readContentAction(pack: string, value: unknown, fallback: ContentAction): ContentAction & GuardrailRuleAction {
  if (value === undefined) return fallback;
  if (value !== "deny" && value !== "redact" && value !== "flag") {
    throw new GuardrailPackError(`${pack} options.action must be "deny", "redact", or "flag"`);
  }
  return value;
}

export const CONTENT_STAGES: readonly ContentStage[] = ["input", "output", "tool_result"];
