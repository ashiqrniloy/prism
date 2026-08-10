/**
 * Bounded page-context evaluation via CDP Runtime.evaluate (0.1.4, plan 016 Task 4).
 * Expression bytes and result bytes are capped; result is JSON-serializable by
 * construction (returnByValue) or surfaced as a bounded exception description.
 */
import { cdpRuntimeEvaluate } from "./cdp.js";
import { BrowserError } from "./errors.js";
import type { PlaywrightCdpSession } from "./types.js";

export interface EvaluateOutcome {
  /** JSON-serializable evaluated value (bounded by maxEvaluateResultBytes). */
  readonly value?: unknown;
  /** Bounded exception description when evaluation threw or was unserializable. */
  readonly exception?: string;
  /** The serialized result was truncated to the byte cap. */
  readonly truncated?: boolean;
}

export interface EvaluateBounds {
  readonly maxActionInputBytes: number;
  readonly actionTimeoutMs: number;
  readonly maxEvaluateResultBytes: number;
}

const MAX_EXCEPTION_DESCRIPTION_BYTES = 2_048;

export async function evaluateInPage(
  session: PlaywrightCdpSession,
  input: { expression: string; awaitPromise?: boolean; timeoutMs?: number },
  bounds: EvaluateBounds,
): Promise<EvaluateOutcome> {
  if (typeof input.expression !== "string" || !input.expression) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "evaluate requires a non-empty expression");
  }
  if (Buffer.byteLength(input.expression, "utf8") > bounds.maxActionInputBytes) {
    throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `expression exceeds maxActionInputBytes ${bounds.maxActionInputBytes}`);
  }
  const timeout = clampTimeout(input.timeoutMs, bounds.actionTimeoutMs);

  const response = await cdpRuntimeEvaluate(session, {
    expression: input.expression,
    awaitPromise: input.awaitPromise === true,
    returnByValue: true,
    userGesture: true,
    timeout,
  });

  if (response.exceptionDetails) {
    return { exception: describeException(response.exceptionDetails) };
  }
  const raw = response.result?.value;
  if (raw === undefined) return { value: undefined };
  const { json, truncated } = boundedJson(raw, bounds.maxEvaluateResultBytes);
  return { value: json, ...(truncated ? { truncated: true } : {}) };
}

function describeException(details: {
  readonly text?: string;
  readonly url?: string;
  readonly lineNumber?: number;
  readonly columnNumber?: number;
  readonly exception?: { readonly description?: string };
}): string {
  const description =
    details.exception?.description && details.exception.description.length > 0
      ? details.exception.description
      : (details.text ?? "unknown exception");
  const bounded = truncateUtf8(description, MAX_EXCEPTION_DESCRIPTION_BYTES);
  const where = details.url && details.lineNumber !== undefined ? ` at ${details.url}:${details.lineNumber + 1}` : "";
  return `${bounded}${where}`;
}

/** JSON-serialize with a byte cap; truncation marks the result, never throws. */
export function boundedJson(value: unknown, maxBytes: number): { json: unknown; truncated: boolean } {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return { json: String(value), truncated: false };
  }
  if (text === undefined) return { json: undefined, truncated: false };
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    // Round-trip back to a real value; the parse is safe (stringify just succeeded).
    return { json: JSON.parse(text) as unknown, truncated: false };
  }
  return { json: truncateUtf8(text, maxBytes), truncated: true };
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return text;
  return `${buf.subarray(0, maxBytes).toString("utf8")}…`;
}

function clampTimeout(value: number | undefined, hard: number): number {
  if (value === undefined) return hard;
  if (!Number.isSafeInteger(value) || value < 1 || value > hard) {
    throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `timeoutMs must be 1..${hard}`);
  }
  return value;
}
