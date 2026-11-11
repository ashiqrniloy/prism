/**
 * Decision-model `ModelProvider` over the shared System One client.
 *
 * Jev and Laya share the wire and the schema compiler. Vendor packages supply
 * id, error label, and base URL; this file owns the gates and the event sequence.
 */
import type {
  DecisionAnswer,
  DecisionRequest,
  DecisionResult,
  DecisionsProvider,
  ModelConfig,
  ModelProvider,
  JsonObject,
  ProviderEvent,
  ProviderRequest,
  StructuredOutputOptions,
} from "../contracts.js";
import { assertDecisionRequest, assertDecisionsSupported, DecisionsError } from "../contracts.js";
import { redactSecrets } from "../redaction.js";
import type { PackageDefinition, PackageInstance } from "../packages/api.js";
import type { JsonSchema } from "../packages/schema.js";
import type { SecretSource } from "./provider-package.js";
import { providerDone, providerError, providerTextDelta, providerUsage } from "../models/events.js";
import { assertStructuredOutputRequestSupported } from "./structured-output.js";
import { trimTrailingSlashes } from "../trim-trailing-slashes.js";
import { mapSystemOneUsage, normalizeSystemOnePath, postSystemOne, warnIfPlaintextRemote } from "./systemone.js";
import { compileSystemOneQuestions, compileSystemOneState, renderSystemOneOutput } from "./systemone-schema.js";
import { resolveProviderMediaMessages } from "./media.js";
import { askSystemOneDecisions } from "./systemone-decisions.js";
import { assertNotAborted, resolveProviderApiKey } from "./routed-provider.js";
import {
  baseUrlProperty,
  defineProviderPackage,
  modelsProperty,
  optionalRefSource,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "./provider-package.js";

/** A `SecretSource` over a key this provider already resolved (once per call, for error redaction). */
function resolvedSecret(value: string | undefined): SecretSource | undefined {
  return value === undefined ? undefined : async () => value;
}

export interface SystemOneDecisionProviderOptions {
  readonly id: string;
  /** Prefix on gate and HTTP errors, e.g. "TypeSafe Jev" or "Laya". */
  readonly label: string;
  readonly baseUrl: string;
  /** Endpoint path; defaults to `/v1/systemone`. Must start with `/`. */
  readonly path?: string;
  /** Curated catalog used to gate `decisions()` calls per model; unknown ids are trusted to the caller. */
  readonly models?: readonly ModelConfig[];
  readonly apiKey?: SecretSource;
  readonly fetch?: typeof fetch;
  /** Retries after the first attempt; forwarded to the shared client (default 2). */
  readonly maxRetries?: number;
  /** Custom warning hook; defaults to console.warn. */
  readonly warn?: (message: string) => void;
}

export function createSystemOneDecisionProvider(options: SystemOneDecisionProviderOptions): ModelProvider {
  const baseUrl = trimTrailingSlashes(options.baseUrl);
  const path = normalizeSystemOnePath(options.path);
  warnIfPlaintextRemote(options.label, baseUrl, options.warn ?? console.warn);
  return {
    id: options.id,

    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      assertNotAborted(request.signal);
      let apiKey: string | undefined;
      try {
        const structuredOutput = requireStructuredOutput(options.label, request);
        apiKey = await resolveProviderApiKey(options.apiKey);
        const booleanThreshold = readBooleanThreshold(options.label, request.options?.compat);
        const media = await resolveProviderMediaMessages(request.messages, request.model, { signal: request.signal });
        const compiled = compileSystemOneState(request.messages, media);
        const response = await postSystemOne(
          {
            model: request.model.model,
            state: compiled.state,
            questions: compileSystemOneQuestions(structuredOutput.schema),
            ...(compiled.images.length > 0 ? { images: compiled.images } : {}),
          },
          {
            provider: options.label,
            baseUrl,
            path,
            apiKey: resolvedSecret(apiKey),
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

    decisions(): DecisionsProvider {
      return {
        id: options.id,
        async decide(request: DecisionRequest): Promise<DecisionResult> {
          assertNotAborted(request.signal);
          const known = options.models?.find((entry) => entry.model === request.model);
          if (known) assertDecisionsSupported(known);
          assertDecisionRequest(request, known ?? { provider: options.id, model: request.model });
          let apiKey: string | undefined;
          try {
            apiKey = await resolveProviderApiKey(options.apiKey);
            const result = await askSystemOneDecisions(
              {
                model: request.model,
                state: request.state ?? "",
                questions: request.questions,
                ...(request.images && request.images.length > 0 ? { images: request.images } : {}),
              },
              {
                provider: options.label,
                baseUrl,
                path,
                apiKey: resolvedSecret(apiKey),
                fetch: options.fetch,
                maxRetries: options.maxRetries,
              },
              request.signal,
            );
            return {
              model: result.model,
              answers: result.answers as Readonly<Record<string, DecisionAnswer>>,
              usage: result.usage,
              timingMs: result.timingMs,
            };
          } catch (error) {
            if (error instanceof DecisionsError || request.signal?.aborted) throw error;
            throw mapDecideError(error, apiKey);
          }
        },
      };
    },
  };
}

/** Every adapter failure surfaces as a kernel DecisionsError with the credential redacted. */
function mapDecideError(error: unknown, apiKey: string | undefined): DecisionsError {
  const message = redactSecrets(error instanceof Error ? error.message : String(error), [apiKey]);
  const mapped = new DecisionsError("invalid_request", message);
  mapped.cause = error;
  return mapped;
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

export interface SystemOneProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to defaultKeyRef. */
  readonly apiKey?: string;
  /** Official base; defaults to defaultBaseUrl. */
  readonly baseUrl?: string;
  /** Endpoint path appended to the base URL; defaults to `/v1/systemone` and must start with `/`. */
  readonly path?: string;
  /** Retries after the first attempt; forwarded to the shared System One client (default 2). */
  readonly maxRetries?: number;
  /** Static catalog. When absent, `models()` returns the curated catalog. */
  readonly models?: readonly ModelConfig[];
}

export interface SystemOneProviderPackageOptions {
  /** Provider id override. */
  readonly id?: string;
  /** Test seam: custom fetch transport. */
  readonly fetch?: typeof fetch;
}

export interface SystemOneProviderPackageSpec {
  readonly name: string;
  readonly providerId: string;
  readonly label: string;
  readonly defaultBaseUrl: string;
  readonly defaultKeyRef: string;
  readonly keyRequired: boolean;
  readonly models: readonly ModelConfig[];
  readonly createProvider?: (options: {
    readonly id?: string;
    readonly baseUrl?: string;
    readonly path?: string;
    readonly apiKey?: SecretSource;
    readonly fetch?: typeof fetch;
    readonly maxRetries?: number;
    readonly warn?: (message: string) => void;
  }) => ModelProvider;
}

export type SystemOnePackageInstanceFactory<
  Config extends SystemOneProviderConfig = SystemOneProviderConfig,
  Options extends SystemOneProviderPackageOptions = SystemOneProviderPackageOptions,
> = (options?: Options & Config) => PackageInstance;

export interface SystemOneProviderPackageResult<
  Config extends SystemOneProviderConfig = SystemOneProviderConfig,
  Options extends SystemOneProviderPackageOptions = SystemOneProviderPackageOptions,
> {
  readonly definition: PackageDefinition<Config>;
  readonly package: SystemOnePackageInstanceFactory<Config, Options>;
}

export function systemOneProviderPackage(spec: SystemOneProviderPackageSpec): SystemOneProviderPackageResult {
  const configSchema: JsonSchema = {
    type: "object",
    properties: {
      apiKey: secretRefProperty(spec.defaultKeyRef),
      baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
      path: {
        type: "string",
        pattern: "^/",
        description: "Endpoint path; defaults to /v1/systemone. Must start with `/`.",
      },
      maxRetries: {
        type: "number",
        minimum: 0,
        description: "Retries after the first attempt; forwarded to the shared System One client (default 2).",
      },
      models: modelsProperty("Static catalog. When absent, `models()` returns the curated catalog."),
    },
    additionalProperties: false,
  };

  function definitionFor(options: SystemOneProviderPackageOptions) {
    return defineProviderPackage<SystemOneProviderConfig>({
      name: spec.name,
      description: `${spec.label} provider package for Prism.`,
      config: configSchema,
      setup: async (prism) => {
        const id = options.id ?? spec.providerId;
        const ref = prism.config.apiKey ?? spec.defaultKeyRef;
        const resolve = (target: string) => prism.credentials.resolve(target);
        const apiKey = spec.keyRequired ? refSource(resolve, ref) : optionalRefSource(resolve, ref);
        if (spec.keyRequired && (await resolve(ref)) === undefined) {
          prism.status.note("warn", `${spec.providerId}: no API key at ${ref}`);
        }
        const baseUrl = prism.config.baseUrl ?? spec.defaultBaseUrl;
        const createFn =
          spec.createProvider ??
          ((o) =>
            createSystemOneDecisionProvider({
              id: o.id ?? id,
              label: spec.label,
              baseUrl: o.baseUrl ?? baseUrl,
              path: o.path,
              models: spec.models,
              apiKey: o.apiKey,
              fetch: o.fetch,
              maxRetries: o.maxRetries,
              warn: o.warn,
            }));
        const provider = createFn({
          id,
          baseUrl,
          path: prism.config.path,
          apiKey,
          fetch: options.fetch,
          maxRetries: prism.config.maxRetries,
          warn: (msg) => prism.status.note("warn", msg),
        });
        const configured = prism.config.models;
        prism.providers.register({
          ...provider,
          async models() {
            return configured ?? spec.models;
          },
        });
      },
    });
  }

  const definition = definitionFor({});

  function instanceFactory(options: SystemOneProviderPackageOptions & SystemOneProviderConfig = {}): PackageInstance {
    return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
  }

  return {
    definition,
    package: instanceFactory,
  };
}
