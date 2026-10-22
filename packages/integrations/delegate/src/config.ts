import type { ModelRef, RunLimits } from "@arnilo/prism";

export type DelegateReport = "on-complete" | "milestones" | "stream";
export type DelegateLifetime = "task" | "session";

/** One child the model may delegate to. The child runs as its own agent over the inherited packages. */
export interface DelegateChildConfig {
  /** Package names (loaded in the parent) the child inherits. Never includes this package. */
  readonly inherit: readonly string[];
  readonly instructions?: string;
  /** Defaults to the parent session's model. */
  readonly model?: ModelRef;
  readonly tools?: { readonly only?: readonly string[] };
  /** May only narrow the delegate ceilings; a larger value is clamped. */
  readonly limits?: DelegateChildLimits;
  readonly lifetime?: DelegateLifetime;
  readonly report?: DelegateReport;
  /** Fraction (0, 1] of the default child limits. */
  readonly budgetShare?: number;
}

export interface DelegateChildLimits {
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxTotalTokens?: number;
  readonly maxWallTimeMs?: number;
}

export interface DelegateConfig {
  readonly children: Readonly<Record<string, DelegateChildConfig>>;
  /** Only `1` today: a child never sees `delegate`, because the package is excluded from its own inherit. */
  readonly maxDepth?: number;
  readonly maxConcurrent?: number;
}

export const DEFAULT_MAX_CONCURRENT = 4;
export const HARD_MAX_CONCURRENT = 32;

const modelRef = {
  anyOf: [
    { type: "string" },
    { type: "object", properties: { provider: { type: "string" }, model: { type: "string" } }, required: ["provider", "model"] },
  ],
} as const;

export const delegateConfigSchema = {
  type: "object",
  properties: {
    children: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          inherit: { type: "array", items: { type: "string" } },
          instructions: { type: "string" },
          model: modelRef,
          tools: { type: "object", properties: { only: { type: "array", items: { type: "string" } } }, additionalProperties: false },
          limits: {
            type: "object",
            properties: {
              maxTurns: { type: "integer", minimum: 1 },
              maxToolCalls: { type: "integer", minimum: 1 },
              maxTotalTokens: { type: "integer", minimum: 1 },
              maxWallTimeMs: { type: "integer", minimum: 1 },
            },
            additionalProperties: false,
          },
          lifetime: { type: "string", enum: ["task", "session"] },
          report: { type: "string", enum: ["on-complete", "milestones", "stream"] },
          budgetShare: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["inherit"],
        additionalProperties: false,
      },
    },
    maxDepth: { type: "integer", minimum: 1, maximum: 1 },
    maxConcurrent: { type: "integer", minimum: 1, maximum: HARD_MAX_CONCURRENT },
  },
  additionalProperties: false,
} as const;

export type { RunLimits };
