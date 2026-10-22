import type { JsonValue } from "../contracts.js";
import type { JsonSchema } from "../packages/schema.js";

/**
 * The agent definition every driver accepts (roadmap §2.12.7). Tools and skills are selected by name
 * from the driver agent's own registries; the spec never carries their definitions.
 */
export interface ExternalAgentSpec {
  readonly name: string;
  readonly systemPrompt?: { readonly replace: string } | { readonly append: string };
  readonly model?: string;
  readonly effort?: "low" | "medium" | "high" | "max";
  /** From this Agent's tool registry, served to the vendor agent. */
  readonly prismTools?: readonly string[];
  /** The vendor's own tools. */
  readonly builtinTools?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] };
  /** From this Agent's kernel skills registry, materialized for the vendor. */
  readonly skills?: readonly string[] | "all";
  readonly subagents?: Readonly<Record<string, Omit<ExternalAgentSpec, "subagents">>>;
  /** The subscription or API-key profile to run under. */
  readonly profile: string;
  /** Default `"strict"`. */
  readonly isolation?: "strict" | "inherit";
  readonly limits?: { readonly maxTurns?: number; readonly maxBudgetUsd?: number };
  /** Vendor-specific options, validated by the driver's own schema. */
  readonly vendor?: Readonly<Record<string, JsonValue>>;
}

/** Top-level spec keys, in schema order. A driver's extra config keys may not reuse them. */
export const EXTERNAL_AGENT_SPEC_KEYS = [
  "name",
  "systemPrompt",
  "model",
  "effort",
  "prismTools",
  "builtinTools",
  "skills",
  "subagents",
  "profile",
  "isolation",
  "limits",
  "vendor",
] as const;

const strings: JsonSchema = { type: "array", items: { type: "string", minLength: 1 } };

const properties = (vendor: JsonSchema): Record<string, JsonSchema> => ({
  name: { type: "string", minLength: 1 },
  // Exactly one of `replace`/`append`, each carrying a string. The branch shapes own the rule: the
  // package validator checks object branches under `oneOf` (plan 164 P1), so no setup-time re-check.
  systemPrompt: {
    oneOf: [
      { type: "object", properties: { replace: { type: "string" } }, required: ["replace"], additionalProperties: false },
      { type: "object", properties: { append: { type: "string" } }, required: ["append"], additionalProperties: false },
    ],
  },
  model: { type: "string", minLength: 1 },
  effort: { type: "string", enum: ["low", "medium", "high", "max"] },
  prismTools: strings,
  builtinTools: { type: "object", properties: { allow: strings, deny: strings }, additionalProperties: false },
  skills: { oneOf: [strings, { type: "string", enum: ["all"] }] },
  isolation: { type: "string", enum: ["strict", "inherit"] },
  limits: {
    type: "object",
    properties: { maxTurns: { type: "integer", minimum: 1 }, maxBudgetUsd: { type: "number", minimum: 0 } },
    additionalProperties: false,
  },
  vendor,
});

/** The vendor schema when a driver declares none: no vendor option is accepted. */
export const EMPTY_VENDOR_SCHEMA: JsonSchema = { type: "object", additionalProperties: false };

/**
 * The JSON Schema of {@link ExternalAgentSpec}. `vendor` is the driver's own schema, so vendor options are
 * validated by the driver and an unknown key fails closed. Sub-agent specs reuse the shape without `subagents`.
 */
export function externalAgentSpecSchema(vendor: JsonSchema = EMPTY_VENDOR_SCHEMA): JsonSchema {
  const base = properties(vendor);
  const sub: JsonSchema = {
    type: "object",
    properties: { ...base, profile: { type: "string", minLength: 1 } },
    required: ["name", "profile"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: { ...base, profile: { type: "string", minLength: 1 }, subagents: { type: "object", additionalProperties: sub } },
    required: ["name", "profile"],
    additionalProperties: false,
  };
}
