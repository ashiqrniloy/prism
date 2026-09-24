/**
 * Decision-model `AIProvider` over the shared System One client.
 *
 * Jev and Laya share the wire and the schema compiler. Vendor packages supply
 * id, error label, and base URL; this file owns the gates and the event sequence.
 */
import type { AIProvider, CredentialValueSource, JsonObject, ProviderEvent, ProviderRequest, StructuredOutputOptions } from "@arnilo/prism";
import {
  assertStructuredOutputRequestSupported,
  providerDone,
  providerError,
  providerTextDelta,
  providerUsage,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { mapSystemOneUsage, postSystemOne } from "./systemone.js";
import { compileSystemOneQuestions, compileSystemOneState, renderSystemOneOutput } from "./systemone-schema.js";

export interface SystemOneDecisionProviderOptions {
  readonly id: string;
  /** Prefix on gate and HTTP errors, e.g. "TypeSafe Jev" or "Laya". */
  readonly label: string;
  readonly baseUrl: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Retries after the first attempt; forwarded to the shared client (default 2). */
  readonly maxRetries?: number;
}

export function createSystemOneDecisionProvider(options: SystemOneDecisionProviderOptions): AIProvider {
  const baseUrl = trimTrailingSlashes(options.baseUrl);
  return {
    id: options.id,
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      let apiKey: string | undefined;
      try {
        const structuredOutput = requireStructuredOutput(options.label, request);
        apiKey = await resolveCredentialValue(options.apiKey, { provider: options.id, name: "apiKey" });
        const booleanThreshold = readBooleanThreshold(options.label, request.options?.compat);
        const response = await postSystemOne(
          {
            model: request.model.model,
            state: compileSystemOneState(request.messages),
            questions: compileSystemOneQuestions(structuredOutput.schema),
          },
          {
            provider: options.label,
            baseUrl,
            apiKey: options.apiKey,
            fetch: options.fetch,
            maxRetries: options.maxRetries,
          },
          request.signal,
        );
        const text = renderSystemOneOutput(response.answers, structuredOutput.schema, { booleanThreshold });
        const usage = mapSystemOneUsage(response.usage);
        yield { type: "message_start" };
        yield providerTextDelta(text);
        if (usage) yield providerUsage(usage);
        yield providerDone(usage, "end_turn");
      } catch (error) {
        yield providerError(error, [apiKey]);
      }
    },
  };
}

/** Fail-closed gates: decision models need a schema and cannot call tools. */
function requireStructuredOutput(label: string, request: ProviderRequest): StructuredOutputOptions {
  if (request.tools && request.tools.length > 0) {
    throw new Error(`${label} is a decision model and does not support tools; remove request.tools`);
  }
  const structuredOutput = request.options?.structuredOutput;
  if (!structuredOutput) {
    throw new Error(`${label} is a decision model: a request needs options.structuredOutput with a JSON schema`);
  }
  assertStructuredOutputRequestSupported(request.model, request.options);
  return structuredOutput;
}

/** Validated here (not just in the renderer) so an out-of-range knob fails before any fetch. */
function readBooleanThreshold(label: string, compat: JsonObject | undefined): number | undefined {
  const value = compat?.boolean_threshold;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} compat.boolean_threshold must be a number between 0 and 1; received ${JSON.stringify(value)}`);
  }
  return value;
}
