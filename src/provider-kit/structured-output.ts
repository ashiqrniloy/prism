import { assertJsonObject } from "../config.js";
import { MAX_RUN_OUTPUT_ERRORS, type RunOutputError } from "../contracts-run-state.js";
import { compileToolSchema } from "../packages/schema.js";
import { canonicalizeJsonSchema } from "./schema.js";
import type {
  AgentConfig,
  ModelCapabilities,
  ModelConfig,
  ProviderRequestOptions,
  RunOptions,
  StructuredOutputOptions,
} from "../contracts.js";
import { mergeProviderRequestOptions } from "./provider-request-policy.js";

export const DEFAULT_MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES = 65_536;
export const DEFAULT_MAX_STRUCTURED_OUTPUT_NAME_LENGTH = 128;
/** Default and ceiling for `StructuredOutputOptions.repair` (plan 235 Task 3). */
export const DEFAULT_STRUCTURED_OUTPUT_REPAIRS = 1;
export const MAX_STRUCTURED_OUTPUT_REPAIRS = 3;
const STRUCTURED_OUTPUT_MODES = new Set(["auto", "native", "prompted"]);

export class StructuredOutputError extends Error {
  readonly code: "invalid_schema" | "unsupported_model" | "schema_too_large" | "invalid_name" | "invalid_option";

  constructor(code: StructuredOutputError["code"], message: string) {
    super(message);
    this.name = "StructuredOutputError";
    this.code = code;
  }
}

export function modelSupportsStructuredOutput(capabilities?: ModelCapabilities): boolean {
  const mode = capabilities?.structuredOutput;
  return mode === true || mode === "json_schema";
}

export function validateStructuredOutputOptions(options: StructuredOutputOptions): StructuredOutputOptions {
  const name = options.name.trim();
  if (!name) throw new StructuredOutputError("invalid_name", "structuredOutput.name is required");
  if (name.length > DEFAULT_MAX_STRUCTURED_OUTPUT_NAME_LENGTH) {
    throw new StructuredOutputError(
      "invalid_name",
      `structuredOutput.name exceeded ${DEFAULT_MAX_STRUCTURED_OUTPUT_NAME_LENGTH} characters`,
    );
  }
  try {
    assertJsonObject(options.schema, "structuredOutput.schema");
  } catch (error) {
    throw new StructuredOutputError(
      "invalid_schema",
      error instanceof Error ? error.message : "structuredOutput.schema must be a JSON object",
    );
  }
  if (options.mode !== undefined && !STRUCTURED_OUTPUT_MODES.has(options.mode)) {
    throw new StructuredOutputError("invalid_option", 'structuredOutput.mode must be "auto", "native", or "prompted"');
  }
  if (
    options.repair !== undefined &&
    (!Number.isInteger(options.repair) || options.repair < 0 || options.repair > MAX_STRUCTURED_OUTPUT_REPAIRS)
  ) {
    throw new StructuredOutputError(
      "invalid_option",
      `structuredOutput.repair must be an integer from 0 to ${MAX_STRUCTURED_OUTPUT_REPAIRS}`,
    );
  }
  const schemaBytes = new TextEncoder().encode(JSON.stringify(options.schema)).byteLength;
  if (schemaBytes > DEFAULT_MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES) {
    throw new StructuredOutputError(
      "schema_too_large",
      `structuredOutput.schema exceeded ${DEFAULT_MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES} bytes`,
    );
  }
  return { ...options, name, schema: options.schema };
}

/**
 * The check a codec runs on a provider request: the request carries native structured output, so the
 * model must declare the capability. `mode: "prompted"` is applied by a session run, which strips the
 * option before the request is built, so a codec never sends it.
 */
export function assertStructuredOutputRequestSupported(model: ModelConfig, options?: ProviderRequestOptions): void {
  if (!options?.structuredOutput) return;
  const structured = validateStructuredOutputOptions(options.structuredOutput);
  if (structured.mode === "prompted") {
    throw new StructuredOutputError(
      "invalid_option",
      'structuredOutput.mode "prompted" is applied by a session run; a direct provider request supports native structured output only',
    );
  }
  if (!modelSupportsStructuredOutput(model.capabilities)) {
    throw new StructuredOutputError(
      "unsupported_model",
      `Model ${model.provider}/${model.model} does not declare the structuredOutput capability; ` +
        'choose a capable model, or set structuredOutput.mode to "prompted" (or "auto") on a session run',
    );
  }
}

/** A session run's structured-output plan: what the provider request carries, and the prompted block if any. */
export interface StructuredOutputRunPlan {
  /** `native` or `prompted`; `undefined` when the run asked for no structured output. */
  readonly mode?: "native" | "prompted";
  /** Provider options for every turn's request: `structuredOutput` is removed in prompted mode. */
  readonly requestOptions: ProviderRequestOptions | undefined;
  /** The prompted-mode instruction, byte-identical for every turn of the run. */
  readonly instruction?: string;
}

/**
 * Resolve a session run's structured-output mode from its model (plan 235 Task 3), before any
 * provider call or hook. `native` on an incapable model fails closed; `auto` falls back to prompted.
 */
export function resolveStructuredOutputRun(
  model: ModelConfig | undefined,
  options: ProviderRequestOptions | undefined,
): StructuredOutputRunPlan {
  if (!options?.structuredOutput) return { requestOptions: options };
  const structured = validateStructuredOutputOptions(options.structuredOutput);
  const capable = model !== undefined && modelSupportsStructuredOutput(model.capabilities);
  const requested = structured.mode ?? "auto";
  if (requested === "native" && model !== undefined && !capable) {
    throw new StructuredOutputError(
      "unsupported_model",
      `Model ${model.provider}/${model.model} does not declare the structuredOutput capability; ` +
        'mode "native" needs a capable model, or set structuredOutput.mode to "prompted"',
    );
  }
  if (requested === "native" || (requested === "auto" && capable)) return { mode: "native", requestOptions: options };
  const { structuredOutput: _removed, ...rest } = options;
  return {
    mode: "prompted",
    requestOptions: Object.keys(rest).length > 0 ? rest : undefined,
    instruction: structuredOutputInstruction(structured),
  };
}

/** The prompted-mode instruction: the schema name and its canonical JSON. One template, stable bytes. */
export function structuredOutputInstruction(options: StructuredOutputOptions): string {
  return (
    `Structured output "${options.name}": your final answer must be a single JSON object that satisfies the JSON Schema below. ` +
    "Reply with the JSON object only: no prose, no code fence. Tool calls before the final answer are allowed.\n" +
    `JSON Schema:\n${JSON.stringify(canonicalizeJsonSchema(options.schema))}`
  );
}

/**
 * The user message a structured-output repair sends (plan 235 Task 3): the violations' paths and
 * expected shapes only, never the previous reply's content.
 */
export function structuredOutputRepairMessage(options: StructuredOutputOptions, error: RunOutputError): string {
  const lines = error.errors.map((entry) => `- ${entry.path || "(root)"}: ${entry.message}`);
  const what = error.code === "invalid_json" ? "was not valid JSON" : "did not satisfy the schema";
  return (
    `Your final answer for structured output "${options.name}" ${what}:\n${lines.join("\n")}\n` +
    "Reply again with only the corrected JSON object."
  );
}

export function resolveRunProviderOptions(
  runOptions: Pick<RunOptions, "providerOptions">,
  config: Pick<AgentConfig, "providerOptions">,
): ProviderRequestOptions | undefined {
  return mergeProviderRequestOptions(config.providerOptions, runOptions.providerOptions);
}

const FENCED_REPLY = /^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

/**
 * Parse a structured-output reply and validate it against the requested schema (plan 235 Task 2).
 * Tolerates one fenced code block around the JSON. Validation uses the tolerant schema compiler:
 * keywords outside the kernel subset are ignored. Errors carry paths and expected shapes only —
 * never reply content, so the JSON parser's own message (which can quote the reply) is dropped.
 */
export function parseStructuredOutput(
  text: string,
  options: StructuredOutputOptions,
): { readonly output: unknown } | { readonly outputError: RunOutputError } {
  const trimmed = text.trim();
  const body = FENCED_REPLY.exec(trimmed)?.[1]?.trim() ?? trimmed;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { outputError: { code: "invalid_json", errors: [{ path: "", message: "reply is not valid JSON" }] } };
  }
  const errors = compileToolSchema(options.schema).validate(value);
  if (errors.length === 0) return { output: value };
  return {
    outputError: {
      code: "schema_mismatch",
      errors: errors.slice(0, MAX_RUN_OUTPUT_ERRORS).map(({ path, message }) => ({ path, message })),
    },
  };
}
