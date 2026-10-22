import type { ModelRef } from "@arnilo/prism";
import type { ModelRouterBudgets, ModelRouterRateLimit } from "./router/types.js";

export interface ModelRouterCircuitConfig {
  readonly failureThreshold?: number;
  readonly cooldownMs?: number;
  readonly coolDownMs?: number;
}

export interface ModelRouterConfig {
  readonly candidates: readonly ModelRef[];
  readonly select?: "ordered" | "cost-latency";
  readonly allow?: readonly ModelRef[];
  readonly budgets?: ModelRouterBudgets;
  readonly rateLimit?: ModelRouterRateLimit;
  readonly circuit?: ModelRouterCircuitConfig;
  readonly residency?: string;
  readonly openRouterRouting?: boolean;
}

export const modelRouterConfigSchema = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        anyOf: [
          { type: "string" },
          {
            type: "object",
            properties: {
              provider: { type: "string" },
              model: { type: "string" },
            },
            required: ["provider", "model"],
          },
        ],
      },
      minItems: 1,
    },
    select: {
      type: "string",
      enum: ["ordered", "cost-latency"],
    },
    allow: {
      type: "array",
      items: {
        anyOf: [
          { type: "string" },
          {
            type: "object",
            properties: {
              provider: { type: "string" },
              model: { type: "string" },
            },
            required: ["provider", "model"],
          },
        ],
      },
    },
    budgets: {
      type: "object",
      properties: {
        maxTokens: { type: "number", minimum: 0 },
        maxCostUsd: { type: "number", minimum: 0 },
        windowMs: { type: "number", minimum: 1 },
        reservationTtlMs: { type: "number", minimum: 1 },
        strict: { type: "boolean" },
      },
      additionalProperties: false,
    },
    rateLimit: {
      type: "object",
      properties: {
        maxRequests: { type: "integer", minimum: 1 },
        windowMs: { type: "integer", minimum: 1 },
      },
      required: ["maxRequests", "windowMs"],
      additionalProperties: false,
    },
    circuit: {
      type: "object",
      properties: {
        failureThreshold: { type: "integer", minimum: 1 },
        cooldownMs: { type: "integer", minimum: 1 },
        coolDownMs: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    residency: {
      type: "string",
    },
    openRouterRouting: {
      type: "boolean",
    },
  },
  // `candidates` is checked in setup rather than declared required: a config schema whose defaults cannot
  // validate would fail package conformance (consistent with other Prism packages like jsonl store).
  additionalProperties: false,
} as const;
