export class AiSdkProviderError extends Error {
  readonly code:
    | "unsupported_specification"
    | "unsupported_content"
    | "invalid_tool_arguments"
    | "aborted"
    | "model_error";

  constructor(code: AiSdkProviderError["code"], message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AiSdkProviderError";
    this.code = code;
  }
}
