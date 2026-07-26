import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { SecretRedactor } from "@arnilo/prism";
import { AiSdkProviderError } from "./errors.js";

export const SUPPORTED_AI_SDK_VERSION_MATRIX = [
  { providerVersion: "4.0.3", specificationVersion: "v4" },
] as const;

export const SUPPORTED_AI_SDK_SPECIFICATION = "v4" as const;

export interface AiSdkProviderOptions {
  /** Host-owned AI SDK language model implementing the pinned v4 ABI. */
  readonly model: LanguageModelV4;
  /** Redacts direct provider errors; agent runs apply their own active redactor. */
  readonly redactor?: SecretRedactor;
  /** Prism provider id. Defaults to `ai-sdk` or `ai-sdk:<model.provider>`. */
  readonly id?: string;
}

export function assertSupportedAiSdkVersion(version: string): void {
  if (SUPPORTED_AI_SDK_VERSION_MATRIX.some((entry) => entry.providerVersion === version)) return;
  throw new AiSdkProviderError(
    "unsupported_version",
    `Unsupported @ai-sdk/provider version "${version}"; supported versions: ${SUPPORTED_AI_SDK_VERSION_MATRIX.map((entry) => entry.providerVersion).join(", ")}`,
  );
}
