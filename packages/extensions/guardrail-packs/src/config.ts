import type { JsonSchema } from "@arnilo/prism";
import { DEFAULT_MAX_SCAN_CHARS } from "./content.js";
import type { GuardrailPackInput } from "./contracts.js";
import { CONTENT_DETECTOR_IDS } from "./detectors/index.js";

/** `guardrailPacks({ packs })` config. An entry is a built-in pack id or an inline/built-in input. */
export interface GuardrailPacksConfig {
  readonly packs?: readonly (string | GuardrailPackInput)[];
  /** Characters a content rule scans per item (default 262,144); the rest passes through, and records say `truncated`. */
  readonly maxScanChars?: number;
}

const toolNameSchema: JsonSchema = { type: "string", minLength: 1, maxLength: 128 };
const detectorSchema: JsonSchema = { type: "string", enum: [...CONTENT_DETECTOR_IDS] };

const ruleSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 96 },
    stage: { type: "string", enum: ["tool_call", "input", "output", "tool_result"] },
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
    // Named detectors only: config never supplies a function.
    detector: { oneOf: [detectorSchema, { type: "array", items: detectorSchema, minItems: 1, maxItems: 16 }] },
    // A model-judged rule (plan 237 Task 3); `model` is a model reference, never a credential.
    judge: {
      type: "object",
      additionalProperties: false,
      required: ["model", "question"],
      properties: {
        model: { type: "string", minLength: 1, maxLength: 256 },
        question: { type: "string", minLength: 1, maxLength: 512 },
        threshold: { type: "number", minimum: 0, maximum: 1 },
        maxInputChars: { type: "integer", minimum: 256 },
        timeoutMs: { type: "integer", minimum: 100 },
        onError: { type: "string", enum: ["deny", "allow"] },
      },
    },
    untrustedOnly: { type: "boolean" },
    alsoScanTools: { type: "array", items: toolNameSchema, minItems: 1, maxItems: 16 },
    action: { type: "string", enum: ["deny", "tripwire", "ask", "redact", "flag"] },
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
    maxScanChars: { type: "integer", minimum: 1024, default: DEFAULT_MAX_SCAN_CHARS },
  },
};
