import type { ModelRef } from "@arnilo/prism";

/** Which part of the conversation the advisor reads. Clamped at setup; the model cannot change it. */
export interface AdvisorContextConfig {
  /** Turns of the branch to include. Default 6, capped at 50. */
  readonly lastTurns?: number;
  /** Character budget for the rendered transcript. Default 24,000, capped at 120,000. */
  readonly maxChars?: number;
}

/** Completion validation. Off unless set. */
export interface AdvisorValidateConfig {
  /** What "done" means for this agent, judged in addition to the task. */
  readonly criteria?: string;
  /** `"model"` (default) makes one model call per round; `{ child }` runs a configured hidden delegate child. */
  readonly engine?: "model" | { readonly child: string };
  /** On a validator failure: `"continue"` (default) with a steer when rounds are left, otherwise end. */
  readonly onError?: "continue" | "end";
  /** Incomplete verdicts before the run ends unverified. Default 2, capped at 10. */
  readonly maxRounds?: number;
  /** Overrides the advisor's context slice for the validator. */
  readonly context?: AdvisorContextConfig;
  /**
   * What the validator is shown of the worker's own account. Both default to `true` (the 0.13.0 behaviour).
   * `transcript: false` drops the CONVERSATION section (model engine); `finalAnswer: false` drops FINAL ANSWER
   * from the model prompt and from the child brief. With both off, the validator sees only the task, the
   * criteria and the evidence from `advisorPackage({ validate: { evidence } })`.
   */
  readonly inputs?: { readonly transcript?: boolean; readonly finalAnswer?: boolean };
  /** Budget for all evidence text in one validation. Default 48,000, capped at 120,000. */
  readonly evidenceMaxChars?: number;
}

export interface AdvisorConfig {
  /** The advisor's own model. Required: a second opinion from the same model is not a second opinion. */
  readonly model: ModelRef;
  /** Replaces the default advisor instructions. */
  readonly instructions?: string;
  readonly context?: AdvisorContextConfig;
  /** Cap on the advice text. Default 4,000, capped at 16,000. */
  readonly adviceMaxChars?: number;
  /** Register the `advise` tool. Default `true`. */
  readonly tool?: boolean;
  readonly triggers?: {
    /** Consult before each named tool call; a revise denies the call with the advice. */
    readonly beforeTools?: readonly string[];
    /** Consult at the natural end of each run; a revise continues the run with a steer. */
    readonly beforeFinish?: boolean;
  };
  /** Model calls one run may spend on advisor consults. Default 3, capped at 20. */
  readonly maxConsultsPerRun?: number;
  readonly validate?: AdvisorValidateConfig;
}

export const DEFAULT_ADVISOR_INSTRUCTIONS =
  "You are a second opinion for another AI agent that is working on a task. Read the conversation and answer its question directly. Point out a wrong approach, a missed requirement, or a risk it has not noticed, and say what to do instead. Be brief: at most a few short paragraphs. You have no tools and cannot act; the agent acts.";

export const DEFAULT_CONTEXT_LAST_TURNS = 6;
export const DEFAULT_CONTEXT_MAX_CHARS = 24_000;
export const HARD_CONTEXT_MAX_CHARS = 120_000;
export const HARD_CONTEXT_LAST_TURNS = 50;
export const DEFAULT_ADVICE_MAX_CHARS = 4_000;
export const HARD_ADVICE_MAX_CHARS = 16_000;
export const DEFAULT_MAX_CONSULTS_PER_RUN = 3;
export const HARD_MAX_CONSULTS_PER_RUN = 20;
export const DEFAULT_MAX_ROUNDS = 2;
export const HARD_MAX_ROUNDS = 10;

export interface ResolvedContext {
  readonly lastTurns: number;
  readonly maxChars: number;
  /** True when a requested value was above its ceiling and was lowered. */
  readonly clamped: boolean;
}

export function resolveContext(config: AdvisorContextConfig | undefined): ResolvedContext {
  const requestedTurns = config?.lastTurns ?? DEFAULT_CONTEXT_LAST_TURNS;
  const requestedChars = config?.maxChars ?? DEFAULT_CONTEXT_MAX_CHARS;
  const lastTurns = Math.min(requestedTurns, HARD_CONTEXT_LAST_TURNS);
  const maxChars = Math.min(requestedChars, HARD_CONTEXT_MAX_CHARS);
  return { lastTurns, maxChars, clamped: lastTurns !== requestedTurns || maxChars !== requestedChars };
}

const clamp = (value: number | undefined, fallback: number, ceiling: number): number => Math.min(value ?? fallback, ceiling);

/** Every knockout is a ceiling, so a config can only narrow. The caller reports one note for the lot. */
export function resolveLimits(config: AdvisorConfig): {
  readonly adviceMaxChars: number;
  readonly maxConsultsPerRun: number;
  readonly maxRounds: number;
  readonly clamped: readonly string[];
} {
  const adviceMaxChars = clamp(config.adviceMaxChars, DEFAULT_ADVICE_MAX_CHARS, HARD_ADVICE_MAX_CHARS);
  const maxConsultsPerRun = clamp(config.maxConsultsPerRun, DEFAULT_MAX_CONSULTS_PER_RUN, HARD_MAX_CONSULTS_PER_RUN);
  const maxRounds = clamp(config.validate?.maxRounds, DEFAULT_MAX_ROUNDS, HARD_MAX_ROUNDS);
  const clamped: string[] = [];
  if (adviceMaxChars !== (config.adviceMaxChars ?? DEFAULT_ADVICE_MAX_CHARS))
    clamped.push(`adviceMaxChars ${config.adviceMaxChars} → ${adviceMaxChars}`);
  if (maxConsultsPerRun !== (config.maxConsultsPerRun ?? DEFAULT_MAX_CONSULTS_PER_RUN)) {
    clamped.push(`maxConsultsPerRun ${config.maxConsultsPerRun} → ${maxConsultsPerRun}`);
  }
  if (config.validate !== undefined && maxRounds !== (config.validate.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
    clamped.push(`validate.maxRounds ${config.validate.maxRounds} → ${maxRounds}`);
  }
  return { adviceMaxChars, maxConsultsPerRun, maxRounds, clamped };
}

const modelRef = {
  anyOf: [
    { type: "string" },
    { type: "object", properties: { provider: { type: "string" }, model: { type: "string" } }, required: ["provider", "model"] },
  ],
} as const;

const contextSchema = {
  type: "object",
  properties: { lastTurns: { type: "integer", minimum: 1 }, maxChars: { type: "integer", minimum: 1 } },
  additionalProperties: false,
} as const;

export const advisorConfigSchema = {
  type: "object",
  properties: {
    model: modelRef,
    instructions: { type: "string", minLength: 1 },
    context: contextSchema,
    adviceMaxChars: { type: "integer", minimum: 1 },
    tool: { type: "boolean" },
    triggers: {
      type: "object",
      properties: { beforeTools: { type: "array", items: { type: "string", minLength: 1 } }, beforeFinish: { type: "boolean" } },
      additionalProperties: false,
    },
    maxConsultsPerRun: { type: "integer", minimum: 1 },
    validate: {
      type: "object",
      properties: {
        criteria: { type: "string" },
        engine: {
          anyOf: [
            { type: "string", enum: ["model"] },
            { type: "object", properties: { child: { type: "string", minLength: 1 } }, required: ["child"], additionalProperties: false },
          ],
        },
        onError: { type: "string", enum: ["continue", "end"] },
        maxRounds: { type: "integer", minimum: 1 },
        context: contextSchema,
        inputs: {
          type: "object",
          properties: { transcript: { type: "boolean" }, finalAnswer: { type: "boolean" } },
          additionalProperties: false,
        },
        evidenceMaxChars: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;
