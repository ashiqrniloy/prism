/** Provider-neutral decision-call contract (plan 195).
 *  A decision model answers typed questions about one state in a single pass and returns
 *  calibrated probabilities, instead of generating text. The vocabulary and answer shapes
 *  mirror System One because every endpoint known today speaks it; the kernel names no vendor.
 *  Validation lives here, once, and runs before any adapter; callers chunk nothing. */
import type { SessionContext } from "../session-context.js";
import type { JsonObject, ModelCapabilities, ModelConfig, Usage } from "./content.js";

/** Text, structured criteria, or message-part arrays accepted as question instructions. */
export type DecisionInstructions = string | JsonObject | readonly unknown[];

export interface DecisionNoulQuestion {
  readonly type: "noul";
  readonly instructions: DecisionInstructions;
  /** Optional descriptions for the true/false outcomes. */
  readonly criteria?: { readonly true?: string; readonly false?: string };
}

export interface DecisionChoiceQuestion {
  readonly type: "choice";
  readonly instructions: DecisionInstructions;
  /** Option → description (or `null` for no description); 2–255 options. */
  readonly criteria: Readonly<Record<string, string | null>>;
}

export interface DecisionScoreQuestion {
  readonly type: "score";
  readonly instructions: DecisionInstructions;
  /** Ordered level descriptions; 2–10 levels. */
  readonly criteria: readonly string[];
}

/** One typed decision question, discriminated by `type`. */
export type DecisionQuestion = DecisionNoulQuestion | DecisionChoiceQuestion | DecisionScoreQuestion;

export interface DecisionNoulAnswer {
  readonly type: "noul";
  /** Calibrated probability in 0..1. */
  readonly noul: number;
}

export interface DecisionChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly probabilities?: Readonly<Record<string, number>>;
  /** Calibrated confidence in 0..1. */
  readonly confidence?: number;
}

export interface DecisionScoreAnswer {
  readonly type: "score";
  /** May land between levels. */
  readonly score: number;
  readonly legend?: Readonly<Record<string, string>>;
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly confidence?: number;
}

/** One answered question, discriminated by `type`. */
export type DecisionAnswer = DecisionNoulAnswer | DecisionChoiceAnswer | DecisionScoreAnswer;

/** Conversation content only — questions written into `state` get judged, not answered. */
export type DecisionState = string | JsonObject | readonly unknown[];

export interface DecisionInput {
  /** Bound by `prism.models.decisions(ref)`; required on the raw `provider.decisions()` adapter. */
  readonly model?: string;
  readonly state?: DecisionState;
  /** Inline `data:image/*` URLs; remote URLs are rejected (no fetch, no SSRF surface). */
  readonly images?: readonly string[];
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
  readonly signal?: AbortSignal;
}

export interface DecisionRequest extends DecisionInput {
  readonly model: string;
}

export interface DecisionResult {
  /** Checkpoint that actually answered; the request's `model` is advisory. */
  readonly model: string;
  /** Raw answers by question id: noul probability, choice probabilities/confidence, score/legend. */
  readonly answers: Readonly<Record<string, DecisionAnswer>>;
  readonly usage?: Usage;
  /** Wall-clock milliseconds for the whole call. */
  readonly timingMs: number;
}

export interface DecisionsProvider {
  readonly id: string;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

/** Options of one {@link DecisionsClient.decide} call (plan 237 Task 3). */
export interface DecisionCallOptions {
  /**
   * The session this call belongs to, normally the one a hook, tool or command handler received. While that session
   * has an active run, the call's usage is charged to the run's token and cost limits, usage and ledger (a
   * `package_call` row), the same way a `models.client(...).generate` call is. Without it nothing is charged to a run.
   * A decision call runs no `model.request` or `model.call` hook: those carry a `ProviderRequest` and a stream.
   */
  readonly session?: SessionContext;
}

/** A package-facing adapter with the model id already bound. */
export interface DecisionsClient {
  readonly id: string;
  decide(request: DecisionInput, options?: DecisionCallOptions): Promise<DecisionResult>;
}

export type DecisionsErrorCode = "unsupported_model" | "invalid_request" | "state_too_large";

export class DecisionsError extends Error {
  readonly code: DecisionsErrorCode;

  constructor(code: DecisionsErrorCode, message: string) {
    super(message);
    this.name = "DecisionsError";
    this.code = code;
  }
}

/** One request may carry at most this many questions (portable kernel bound; the raw System One cap is 256). */
export const MAX_DECISION_QUESTIONS = 64;
/** Choice questions accept at most this many options. */
export const MAX_DECISION_CHOICE_OPTIONS = 255;
/** Score rubrics accept at most this many levels. */
export const MAX_DECISION_SCORE_LEVELS = 10;
/** Serialized `state` ceiling for one decision call: 256 KiB. */
export const DEFAULT_MAX_DECISION_STATE_BYTES = 262_144;
/** Total inline image ceiling for one decision call: 8 MiB. */
export const DEFAULT_MAX_DECISION_IMAGE_BYTES = 8 * 1024 * 1024;

export function modelSupportsDecisions(capabilities?: ModelCapabilities): boolean {
  return capabilities?.decisions === true;
}

export function assertDecisionsSupported(model: ModelConfig): void {
  if (!modelSupportsDecisions(model.capabilities)) {
    throw new DecisionsError("unsupported_model", `Model ${model.provider}/${model.model} does not declare the decisions capability`);
  }
}

/** Byte bounds an adapter applies to a decisions request (plan 239 Task 4); a provider package sets them from its config. */
export interface DecisionRequestBounds {
  /** Serialized `state` bytes. Default {@link DEFAULT_MAX_DECISION_STATE_BYTES}. */
  readonly maxStateBytes?: number;
  /** Decoded bytes of all `images`. Default {@link DEFAULT_MAX_DECISION_IMAGE_BYTES}. */
  readonly maxImageBytes?: number;
}

/** Enforces every kernel bound before an adapter builds a request. */
export function assertDecisionRequest(request: DecisionRequest, model: ModelConfig, bounds: DecisionRequestBounds = {}): void {
  if (typeof request.model !== "string" || !request.model.trim()) invalid("model must be a non-empty string");
  validateState(request.state, bounds.maxStateBytes ?? DEFAULT_MAX_DECISION_STATE_BYTES);
  validateImages(request.images, model, bounds.maxImageBytes ?? DEFAULT_MAX_DECISION_IMAGE_BYTES);
  validateQuestions(request.questions);
}

function validateState(state: DecisionState | undefined, maxBytes: number): void {
  if (state === undefined) return;
  if (typeof state !== "string" && !isObject(state) && !Array.isArray(state)) {
    invalid("state must be a string, object, or array");
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(state);
  } catch (error) {
    invalid(`state is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (serialized === undefined) invalid("state is not JSON-serializable");
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > maxBytes) {
    throw new DecisionsError("state_too_large", `state serialized to ${bytes} bytes; the limit is ${maxBytes}`);
  }
}

function validateImages(images: readonly string[] | undefined, model: ModelConfig, maxBytes: number): void {
  if (images === undefined) return;
  if (!Array.isArray(images)) invalid("images must be an array of data: URLs");
  if (images.length === 0) return;
  // Undeclared input means unknown, matching the kernel's media gate; a declared list without `image` fails closed.
  const declared = model.capabilities?.input;
  if (declared !== undefined && !declared.includes("image")) {
    invalid(`Model ${model.provider}/${model.model} does not declare image input; request carried ${images.length} image(s)`);
  }
  let total = 0;
  for (const [index, url] of images.entries()) {
    const field = `images[${index}]`;
    if (typeof url !== "string") invalid(`${field} must be a string`);
    const match = /^data:(image\/[a-z0-9][a-z0-9.+-]*);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!match) invalid(`${field} must be a data:image/*;base64 URL`);
    total += decodedBase64Bytes(match[2]!);
    if (total > maxBytes) {
      throw new DecisionsError("state_too_large", `images decoded to ${total} bytes; the limit is ${maxBytes}`);
    }
  }
}

function decodedBase64Bytes(payload: string): number {
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return (payload.length * 3) / 4 - padding;
}

function validateQuestions(questions: Readonly<Record<string, DecisionQuestion>>): void {
  if (!isObject(questions) || Array.isArray(questions)) invalid("questions must be an object keyed by question id");
  const entries = Object.entries(questions);
  if (entries.length === 0) invalid("questions must contain at least one question");
  if (entries.length > MAX_DECISION_QUESTIONS) {
    invalid(`questions carried ${entries.length}; the limit is ${MAX_DECISION_QUESTIONS}`);
  }
  for (const [id, question] of entries) validateQuestion(id, question);
}

function validateQuestion(id: string, question: DecisionQuestion): void {
  if (!isObject(question)) invalid(`question "${id}" must be an object`);
  if (!isInstructions(question.instructions)) {
    invalid(`question "${id}" instructions must be a non-empty string, object, or array`);
  }
  switch (question.type) {
    case "noul": {
      const criteria = question.criteria;
      if (criteria === undefined) return;
      if (!isObject(criteria)) invalid(`question "${id}" noul criteria must be an object`);
      for (const [key, value] of Object.entries(criteria)) {
        if (key !== "true" && key !== "false") continue;
        if (typeof value !== "string") invalid(`question "${id}" noul criteria.${key} must be a string`);
      }
      return;
    }
    case "choice": {
      const criteria = question.criteria;
      if (!isObject(criteria) || Array.isArray(criteria)) {
        invalid(`question "${id}" choice criteria must be an object of option descriptions`);
      }
      const options = Object.entries(criteria);
      if (options.length < 2 || options.length > MAX_DECISION_CHOICE_OPTIONS) {
        invalid(`question "${id}" choice criteria carried ${options.length} options; the limit is 2-${MAX_DECISION_CHOICE_OPTIONS}`);
      }
      for (const [option, description] of options) {
        if (description !== null && typeof description !== "string") {
          invalid(`question "${id}" choice criteria.${option} must be a string or null`);
        }
      }
      return;
    }
    case "score": {
      const criteria = question.criteria;
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > MAX_DECISION_SCORE_LEVELS) {
        invalid(`question "${id}" score criteria must be an array of 2-${MAX_DECISION_SCORE_LEVELS} level descriptions`);
      }
      if (!criteria.every((level) => typeof level === "string")) {
        invalid(`question "${id}" score criteria must contain only strings`);
      }
      return;
    }
    default:
      invalid(
        `question "${id}" has unsupported type ${JSON.stringify((question as { type: unknown }).type)}; expected noul, choice, or score`,
      );
  }
}

function isInstructions(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return isObject(value) || Array.isArray(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalid(message: string): never {
  throw new DecisionsError("invalid_request", message);
}
