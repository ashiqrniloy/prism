import { createRequire } from "node:module";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { AIProvider, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { assertStructuredOutputRequestSupported, providerError } from "@arnilo/prism";
import { AiSdkProviderError } from "./errors.js";
import { toAiSdkCallOptions } from "./prompt.js";
import { mapAiSdkStream } from "./stream.js";
import { type AiSdkProviderOptions, assertSupportedAiSdkVersion, SUPPORTED_AI_SDK_SPECIFICATION } from "./types.js";

const installedVersion = readInstalledVersion();

export function createAiSdkProvider(options: AiSdkProviderOptions): AIProvider {
  assertSupportedAiSdkVersion(installedVersion);
  const model = assertLanguageModelV4(options.model);
  const id = options.id ?? (model.provider ? `ai-sdk:${model.provider}` : "ai-sdk");

  return {
    id,
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      if (request.signal?.aborted) {
        yield errorEvent(
          new AiSdkProviderError("aborted", "AI SDK provider request aborted", {
            cause: request.signal.reason,
          }),
          options,
        );
        return;
      }

      try {
        assertStructuredOutputRequestSupported(request.model, request.options);
        const callOptions = toAiSdkCallOptions(request);
        // Abort/resource limits always come from Prism request.signal. Adapter
        // options cannot replace or widen that bound.
        callOptions.abortSignal = request.signal;
        const result = await model.doStream(callOptions);
        yield* mapAiSdkStream(result.stream, request.signal, options.redactor);
      } catch (error) {
        if (request.signal?.aborted) {
          yield errorEvent(
            new AiSdkProviderError("aborted", "AI SDK provider request aborted", {
              cause: request.signal.reason ?? error,
            }),
            options,
          );
          return;
        }
        yield errorEvent(
          error instanceof AiSdkProviderError
            ? error
            : new AiSdkProviderError("model_error", error instanceof Error ? error.message : "AI SDK model failed", { cause: error }),
          options,
        );
      }
    },
  };
}

function assertLanguageModelV4(model: LanguageModelV4): LanguageModelV4 {
  if (!model || model.specificationVersion !== SUPPORTED_AI_SDK_SPECIFICATION) {
    throw new AiSdkProviderError(
      "unsupported_specification",
      `createAiSdkProvider requires LanguageModelV4 (specificationVersion "${SUPPORTED_AI_SDK_SPECIFICATION}")`,
    );
  }
  if (typeof model.doStream !== "function") {
    throw new AiSdkProviderError("unsupported_specification", "createAiSdkProvider requires LanguageModelV4.doStream");
  }
  return model;
}

function readInstalledVersion(): string {
  const pkg = createRequire(import.meta.url)("@ai-sdk/provider/package.json") as { version?: unknown };
  if (typeof pkg.version === "string") return pkg.version;
  throw new AiSdkProviderError("unsupported_version", "Could not determine installed @ai-sdk/provider version");
}

function errorEvent(error: unknown, options: AiSdkProviderOptions): ProviderEvent {
  const event = providerError(error) as Extract<ProviderEvent, { type: "error" }>;
  return options.redactor ? { ...event, error: options.redactor.redact(event.error) } : event;
}

export type { AiSdkProviderOptions };
