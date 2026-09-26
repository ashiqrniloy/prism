/**
 * Host-facing typed decision call over the shared System One wire client.
 *
 * The `typesafe` and `laya` provider adapters render schema-shaped JSON text and deliberately
 * do not copy answer probabilities, confidence, legends, the actual responding checkpoint,
 * usage, or timing onto their events. Hosts that gate on calibrated confidence need those
 * raw values, so this subpath performs one `POST /v1/systemone` call and returns them
 * untouched. It reuses the shared client's retry loop, credential resolution, bounded
 * response parsing, and typed errors; it adds only pre-fetch request bounds, an optional
 * whole-call deadline, and abort normalization. No timeout or failure ever becomes a
 * synthetic neutral answer.
 */
import type { Usage } from "@arnilo/prism";
import { isJsonObject } from "@arnilo/prism";
import {
  mapSystemOneUsage,
  postSystemOne,
  SystemOneAbortedError,
  type SystemOneAnswer,
  type SystemOneBody,
  type SystemOneClientOptions,
  SystemOneError,
  type SystemOneQuestion,
} from "../shared/systemone.js";
import { MAX_SYSTEMONE_CHOICE_OPTIONS, MAX_SYSTEMONE_QUESTIONS, MAX_SYSTEMONE_SCORE_LEVELS } from "../shared/systemone-schema.js";

export {
  SystemOneAbortedError,
  type SystemOneAnswer,
  SystemOneAuthError,
  type SystemOneBody,
  type SystemOneChoiceAnswer,
  type SystemOneChoiceQuestion,
  type SystemOneClientOptions,
  SystemOneError,
  type SystemOneInstructions,
  SystemOneInvalidRequestError,
  type SystemOneNoulAnswer,
  type SystemOneNoulQuestion,
  type SystemOneQuestion,
  type SystemOneResponse,
  SystemOneRetryExhaustedError,
  type SystemOneScoreAnswer,
  type SystemOneScoreQuestion,
  type SystemOneState,
  type SystemOneUsage,
} from "../shared/systemone.js";
export {
  compileSystemOneQuestions,
  compileSystemOneState,
  MAX_SYSTEMONE_CHOICE_OPTIONS,
  MAX_SYSTEMONE_QUESTIONS,
  MAX_SYSTEMONE_SCORE_LEVELS,
  SystemOneSchemaError,
  type SystemOneSchemaErrorCode,
} from "../shared/systemone-schema.js";

/** Serialized `state` ceiling for one decision call: 256 KiB. */
export const DEFAULT_MAX_SYSTEMONE_STATE_BYTES = 262_144;

export interface SystemOneDecisionOptions extends SystemOneClientOptions {
  /** Whole-call deadline in milliseconds, retries included. Omit for no client-side deadline. */
  readonly timeoutMs?: number;
  /** Serialized `state` byte ceiling. Default {@link DEFAULT_MAX_SYSTEMONE_STATE_BYTES}. */
  readonly maxStateBytes?: number;
}

export interface SystemOneDecisionResult {
  /** Checkpoint that actually answered; the request's `model` is advisory. */
  readonly model: string;
  /** Raw answers by question id: noul probability, choice probabilities/confidence, score/legend. */
  readonly answers: Readonly<Record<string, SystemOneAnswer>>;
  /** Input-token usage, mapped the same way the adapters map it (output tokens stay 0). */
  readonly usage?: Usage;
  /** Wall-clock milliseconds for the whole call, retries included. */
  readonly timingMs: number;
}

/**
 * One System One decision call: validates the request against the API limits, then posts it
 * through {@link postSystemOne} and returns the raw answers with the responding model,
 * mapped usage, and elapsed wall time. Questions must be compiled (from JSON Schema with
 * {@link compileSystemOneQuestions} or by hand) before calling; the wrapper never renders
 * answers into schema values and never coerces them to booleans.
 *
 * `options.timeoutMs` bounds the whole call including retries; `signal` cancels it. Both
 * compose: whichever aborts first wins, and neither produces an answer — the call rejects
 * with {@link SystemOneAbortedError}. Failures keep their typed classes (auth, invalid
 * request, retry exhausted); local bound violations throw {@link SystemOneError} with
 * `status` 0 before any fetch.
 */
export async function askSystemOneDecisions(
  body: SystemOneBody,
  options: SystemOneDecisionOptions,
  signal?: AbortSignal,
): Promise<SystemOneDecisionResult> {
  validateSystemOneDecisionRequest(body, options);
  const deadline = options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs);
  const composed = deadline ? (signal ? AbortSignal.any([signal, deadline]) : deadline) : signal;
  const startedAt = performance.now();
  try {
    const response = await postSystemOne(body, options, composed);
    return {
      model: response.model,
      answers: response.answers,
      usage: mapSystemOneUsage(response.usage),
      timingMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    throw normalizeSystemOneAbort(error, options.provider, composed, options.timeoutMs);
  }
}

/** Pre-fetch gates mirror the schema compiler's limits plus the state and deadline bounds. */
function validateSystemOneDecisionRequest(body: SystemOneBody, options: SystemOneDecisionOptions): void {
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    invalidRequest(`timeoutMs must be a positive finite number of milliseconds; received ${JSON.stringify(options.timeoutMs)}`);
  }
  const maxStateBytes = options.maxStateBytes ?? DEFAULT_MAX_SYSTEMONE_STATE_BYTES;
  if (!Number.isSafeInteger(maxStateBytes) || maxStateBytes <= 0) {
    invalidRequest(`maxStateBytes must be a positive integer; received ${JSON.stringify(options.maxStateBytes)}`);
  }
  if (!isJsonObject(body)) invalidRequest("body must be an object");
  if (typeof body.model !== "string" || !body.model.trim()) invalidRequest("model must be a non-empty string");
  validateState(body.state, maxStateBytes);
  if (!isJsonObject(body.questions)) invalidRequest("questions must be an object keyed by question id");
  const questions = Object.entries(body.questions);
  if (questions.length === 0) invalidRequest("questions must contain at least one question");
  if (questions.length > MAX_SYSTEMONE_QUESTIONS) {
    invalidRequest(`questions carried ${questions.length}; the System One limit is ${MAX_SYSTEMONE_QUESTIONS}`);
  }
  for (const [id, question] of questions) validateQuestion(id, question);
}

function validateState(state: unknown, maxStateBytes: number): void {
  if (typeof state !== "string" && !isJsonObject(state) && !Array.isArray(state)) {
    invalidRequest("state must be a string, object, or array");
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(state);
  } catch (error) {
    invalidRequest(`state is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (serialized === undefined) invalidRequest("state is not JSON-serializable");
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > maxStateBytes) invalidRequest(`state serialized to ${bytes} bytes; the limit is ${maxStateBytes}`);
}

function validateQuestion(id: string, question: SystemOneQuestion): void {
  if (!isJsonObject(question)) invalidRequest(`question "${id}" must be an object`);
  if (!isInstructions(question.instructions)) {
    invalidRequest(`question "${id}" instructions must be a non-empty string, object, or array`);
  }
  const type: string = question.type;
  switch (type) {
    case "noul": {
      const criteria = question.criteria;
      if (criteria === undefined) return;
      if (!isJsonObject(criteria)) invalidRequest(`question "${id}" noul criteria must be an object`);
      for (const [key, value] of Object.entries(criteria)) {
        if (key !== "true" && key !== "false") continue;
        if (typeof value !== "string") invalidRequest(`question "${id}" noul criteria.${key} must be a string`);
      }
      return;
    }
    case "choice": {
      const criteria = question.criteria;
      if (!isJsonObject(criteria)) invalidRequest(`question "${id}" choice criteria must be an object of option descriptions`);
      const options = Object.entries(criteria);
      if (options.length < 2 || options.length > MAX_SYSTEMONE_CHOICE_OPTIONS) {
        invalidRequest(
          `question "${id}" choice criteria carried ${options.length} options; the System One limit is 2-${MAX_SYSTEMONE_CHOICE_OPTIONS}`,
        );
      }
      for (const [option, description] of options) {
        if (description !== null && typeof description !== "string") {
          invalidRequest(`question "${id}" choice criteria.${option} must be a string or null`);
        }
      }
      return;
    }
    case "score": {
      const criteria = question.criteria;
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > MAX_SYSTEMONE_SCORE_LEVELS) {
        invalidRequest(`question "${id}" score criteria must be an array of 2-${MAX_SYSTEMONE_SCORE_LEVELS} level descriptions`);
      }
      if (!criteria.every((level) => typeof level === "string")) {
        invalidRequest(`question "${id}" score criteria must contain only strings`);
      }
      return;
    }
    default:
      invalidRequest(`question "${id}" has unsupported type ${JSON.stringify(type)}; expected noul, choice, or score`);
  }
}

function isInstructions(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return isJsonObject(value) || Array.isArray(value);
}

/** Local violation: no request was sent, so the status stays 0. */
function invalidRequest(message: string): never {
  throw new SystemOneError(`invalid System One decision request: ${message}`, 0);
}

/** Native fetch aborts are normalized so hosts catch one error family for every failure mode. */
function normalizeSystemOneAbort(
  error: unknown,
  provider: string,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): unknown {
  if (error instanceof SystemOneError) return error;
  const name = error instanceof Error ? error.name : undefined;
  if (signal?.aborted && (name === "AbortError" || name === "TimeoutError")) {
    const message =
      name === "TimeoutError" && timeoutMs !== undefined
        ? `${provider} systemone exceeded its ${timeoutMs}ms deadline`
        : `${provider} systemone call aborted`;
    return new SystemOneAbortedError(message, error);
  }
  return error;
}
