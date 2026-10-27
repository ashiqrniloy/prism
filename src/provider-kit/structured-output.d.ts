import type { AgentConfig, ModelCapabilities, ModelConfig, ProviderRequest, ProviderRequestOptions, RunOptions, StructuredOutputOptions } from "../contracts.js";
export declare const DEFAULT_MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES = 65536;
export declare const DEFAULT_MAX_STRUCTURED_OUTPUT_NAME_LENGTH = 128;
export declare class StructuredOutputError extends Error {
    readonly code: "invalid_schema" | "unsupported_model" | "schema_too_large" | "invalid_name";
    constructor(code: StructuredOutputError["code"], message: string);
}
export declare function modelSupportsStructuredOutput(capabilities?: ModelCapabilities): boolean;
export declare function validateStructuredOutputOptions(options: StructuredOutputOptions): StructuredOutputOptions;
export declare function assertStructuredOutputRequestSupported(model: ModelConfig, options?: ProviderRequestOptions): void;
export declare function resolveRunProviderOptions(runOptions: Pick<RunOptions, "providerOptions">, config: Pick<AgentConfig, "providerOptions">): ProviderRequestOptions | undefined;
/** Strip native schema so a tool-eligible turn can call tools freely. */
export declare function withoutStructuredOutput(request: ProviderRequest): ProviderRequest;
/** Artifact/revision turn: keep/restore schema and withdraw tools. */
export declare function artifactStructuredOutputRequest(request: ProviderRequest, schema?: StructuredOutputOptions): ProviderRequest;
