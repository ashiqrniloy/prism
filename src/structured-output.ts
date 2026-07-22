import type {
  AgentConfig,
  AgentLoopOptions,
  AgentLoopStrategy,
  ModelCapabilities,
  ModelConfig,
  ProviderRequest,
  ProviderRequestOptions,
  RunOptions,
  StructuredOutputOptions,
} from "./contracts.js";
import { assertJsonObject } from "./config.js";
import { mergeProviderRequestOptions } from "./provider-request-policy.js";

export const DEFAULT_MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES = 65_536;
export const DEFAULT_MAX_STRUCTURED_OUTPUT_NAME_LENGTH = 128;

export class StructuredOutputError extends Error {
  readonly code: "invalid_schema" | "unsupported_model" | "schema_too_large" | "invalid_name";

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
  const schemaBytes = new TextEncoder().encode(JSON.stringify(options.schema)).byteLength;
  if (schemaBytes > DEFAULT_MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES) {
    throw new StructuredOutputError(
      "schema_too_large",
      `structuredOutput.schema exceeded ${DEFAULT_MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES} bytes`,
    );
  }
  return { ...options, name, schema: options.schema };
}

export function assertStructuredOutputRequestSupported(
  model: ModelConfig,
  options?: ProviderRequestOptions,
): void {
  if (!options?.structuredOutput) return;
  validateStructuredOutputOptions(options.structuredOutput);
  if (!modelSupportsStructuredOutput(model.capabilities)) {
    throw new StructuredOutputError(
      "unsupported_model",
      `Model ${model.provider}/${model.model} does not declare structuredOutput capability; `
      + `set loop.structuredOutputMode to "artifact-loop" or choose a capable model`,
    );
  }
}

function isGenerateValidateReviseLoopOptions(
  loop: AgentLoopStrategy | AgentLoopOptions | undefined,
): loop is Extract<AgentLoopOptions, { strategy: "generate-validate-revise" }> {
  return typeof loop === "object" && loop !== null && "strategy" in loop && loop.strategy === "generate-validate-revise";
}

export function resolveRunProviderOptions(
  runOptions: Pick<RunOptions, "providerOptions" | "loop">,
  config: Pick<AgentConfig, "providerOptions" | "loop">,
): ProviderRequestOptions | undefined {
  const merged = mergeProviderRequestOptions(config.providerOptions, runOptions.providerOptions);
  const loop = runOptions.loop ?? config.loop;
  if (!isGenerateValidateReviseLoopOptions(loop)) return merged;
  if (loop.structuredOutputMode === "artifact-loop" || !loop.structuredOutput) return merged;
  return mergeProviderRequestOptions(merged, {
    structuredOutput: validateStructuredOutputOptions(loop.structuredOutput),
  });
}

/** Strip native schema so a tool-eligible turn can call tools freely. */
export function withoutStructuredOutput(request: ProviderRequest): ProviderRequest {
  if (!request.options?.structuredOutput) return request;
  const { structuredOutput: _drop, ...options } = request.options;
  return { ...request, options: Object.keys(options).length > 0 ? options : undefined };
}

/** Artifact/revision turn: keep/restore schema and withdraw tools. */
export function artifactStructuredOutputRequest(
  request: ProviderRequest,
  schema?: StructuredOutputOptions,
): ProviderRequest {
  const structuredOutput = schema ?? request.options?.structuredOutput;
  if (!structuredOutput) return { ...request, tools: undefined };
  return {
    ...request,
    tools: undefined,
    options: { ...request.options, structuredOutput },
  };
}
