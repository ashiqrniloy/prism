import type { JsonSchema } from "@arnilo/prism";
import type { GuardrailPackInput } from "./contracts.js";

/** `guardrailPacks({ packs })` config. An entry is a built-in pack id or an inline/built-in input. */
export interface GuardrailPacksConfig {
  readonly packs?: readonly (string | GuardrailPackInput)[];
}

const ruleSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 96 },
    // Config is JSON: a pattern is a string (compiled once), never a RegExp or a `deny` predicate.
    pattern: { type: "string", minLength: 1, maxLength: 4096 },
    tool: {
      oneOf: [
        { type: "string", minLength: 1, maxLength: 128 },
        { type: "array", items: { type: "string", minLength: 1, maxLength: 128 }, minItems: 1, maxItems: 64 },
      ],
    },
    argPath: {
      oneOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "array", items: { type: "string", minLength: 1, maxLength: 256 }, minItems: 1, maxItems: 8 },
      ],
    },
    action: { type: "string", enum: ["deny", "tripwire", "ask"] },
    reason: { type: "string", minLength: 1, maxLength: 512 },
  },
};

const packInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 96 },
    version: { type: "integer", minimum: 1 },
    options: { type: "object", additionalProperties: true },
    rules: { type: "array", items: ruleSchema, minItems: 1, maxItems: 64 },
  },
};

export const guardrailPacksConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    packs: {
      type: "array",
      // `additionalProperties: true` keeps the schema compiler from rejecting the object branch's
      // keys before `oneOf` runs (a `oneOf` node with no `type` also runs object validation).
      items: { oneOf: [{ type: "string", minLength: 1, maxLength: 96 }, packInputSchema], additionalProperties: true },
      maxItems: 8,
      default: [],
    },
  },
};
