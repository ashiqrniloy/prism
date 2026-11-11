import type { JsonValue } from "@arnilo/prism";

/** At most five missing items, each at most 200 chars: an event is a summary, never the transcript. */
export const MAX_MISSING_ITEMS = 5;
export const MAX_MISSING_CHARS = 200;

/**
 * The first JSON object in a model answer, or `undefined`. Models wrap JSON in prose or fences even when
 * told not to, so the outermost braces win; anything that does not parse is a failure, never a guess.
 */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export type AdviceVerdict = { readonly verdict: "proceed" } | { readonly verdict: "revise"; readonly advice: string };

/** `{ verdict, advice }` for the review triggers, or `undefined` when the answer is not that shape. */
export function parseAdviceVerdict(text: string, maxChars: number): AdviceVerdict | undefined {
  const parsed = parseJsonObject(text);
  if (parsed === undefined) return undefined;
  if (parsed.verdict === "proceed") return { verdict: "proceed" };
  if (parsed.verdict !== "revise") return undefined;
  const advice = typeof parsed.advice === "string" ? parsed.advice.trim() : "";
  if (advice.length === 0) return undefined;
  return { verdict: "revise", advice: advice.slice(0, maxChars) };
}

export type CompletionVerdict = { readonly verdict: "complete" } | { readonly verdict: "incomplete"; readonly missing: readonly string[] };

/**
 * `{ verdict, missing }` for the validator, or `undefined`. A malformed or oversized answer is an error,
 * never `verified`, so an unparseable child cannot pass a run.
 */
export function parseCompletionVerdict(text: string): CompletionVerdict | undefined {
  const parsed = parseJsonObject(text);
  if (parsed === undefined) return undefined;
  if (parsed.verdict === "complete") return { verdict: "complete" };
  if (parsed.verdict !== "incomplete") return undefined;
  const raw = Array.isArray(parsed.missing) ? parsed.missing : [];
  const missing = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_MISSING_ITEMS)
    .map((item) => item.slice(0, MAX_MISSING_CHARS));
  return { verdict: "incomplete", missing };
}

/** The JSON-only answer text a model can produce without tools. */
export const ADVICE_JSON_INSTRUCTION =
  'Reply with JSON only, no prose and no code fences: {"verdict":"proceed"|"revise","advice":"what to do instead, or empty when proceeding"}.';

export const COMPLETE_JSON_INSTRUCTION =
  'Reply with JSON only, no prose and no code fences: {"verdict":"complete"|"incomplete","missing":["what is not done yet"],"evidence":"what shows it"}.';

/** JSON-safe `package.event` data: unknown extra keys never leak into an event. */
export const eventData = (data: Readonly<Record<string, JsonValue | undefined>>): JsonValue => {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(data)) if (value !== undefined) out[key] = value;
  return out;
};
