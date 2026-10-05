/**
 * `@arnilo/prism-provider-ai-sdk` — the AI SDK bridge provider package.
 *
 * ```ts
 * import aiSdk from "@arnilo/prism-provider-ai-sdk";
 * import { createOpenAI } from "@ai-sdk/openai";
 * import { createAgent } from "@arnilo/prism";
 *
 * const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
 * const agent = await createAgent({
 *   model: "ai-sdk:openai/gpt-5.1",
 *   packages: [aiSdk({ model: openai("gpt-5.1") })],
 * });
 * ```
 *
 * Unlike the HTTP vendor packages this one owns no wire: it adapts a **host-owned**
 * `LanguageModelV4` into a Prism provider, so the model instance is a factory-only option (it is not
 * JSON and can never come from a manifest or `packageConfig`). `@ai-sdk/provider` stays an optional
 * peer of this package only — the kernel and every other provider package never load it.
 *
 * Setup fails closed and never throws (roadmap §2.6): a missing peer, an unlisted peer version, or
 * no host model records a `status.note` and registers nothing, so `createAgent` still succeeds and
 * the host sees why. A direct `createAiSdkProvider()` call keeps the strict version-matrix check.
 */
import { type JsonSchema, type ModelConfig, type PackageInstance, type SecretRedactor } from "@arnilo/prism";
import { defineProviderPackage, modelsProperty, providerPackageInstance } from "@arnilo/prism/provider-kit";
import type { LanguageModelV4 } from "@ai-sdk/provider";

import { createAiSdkProvider } from "./provider.js";
import { type AiSdkPeerProbe, probeAiSdkPeer, SUPPORTED_AI_SDK_VERSION_MATRIX } from "./types.js";

export { AiSdkProviderError } from "./errors.js";
export { toAiSdkCallOptions, toAiSdkPrompt, toAiSdkTool } from "./prompt.js";
export { createAiSdkProvider } from "./provider.js";
export { mapAiSdkStream, mapUsage } from "./stream.js";
export {
  type AiSdkPeerProbe,
  type AiSdkProviderOptions,
  assertSupportedAiSdkVersion,
  probeAiSdkPeer,
  readInstalledAiSdkVersion,
  SUPPORTED_AI_SDK_SPECIFICATION,
  SUPPORTED_AI_SDK_VERSION_MATRIX,
} from "./types.js";

/** The optional peer this package reads at setup; it is never a dependency of the kernel. */
export const AI_SDK_PEER = "@ai-sdk/provider";

export interface AiSdkProviderPackageOptions {
  /** Host-owned AI SDK language model implementing the pinned v4 ABI. Factory-only: not JSON. */
  readonly model?: LanguageModelV4;
  /** Redacts direct provider errors; agent runs apply their own active redactor. */
  readonly redactor?: SecretRedactor;
  /** Test seam: how the optional peer version is read. Defaults to the real `createRequire` read. */
  readonly readVersion?: () => string;
}

/** The config a host (or a code instance) may set. A model instance cannot live here: it is not JSON. */
export interface AiSdkProviderConfig {
  /** Prism provider id; defaults to `ai-sdk` or `ai-sdk:<model.provider>`. */
  readonly id?: string;
  /** Static catalog. When absent, `models()` derives one entry from the host model. */
  readonly models?: readonly ModelConfig[];
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, description: "Prism provider id; defaults to `ai-sdk:<model.provider>`." },
    models: modelsProperty("Static catalog; when absent, `models()` derives one entry from the host model."),
  },
  additionalProperties: false,
};

/** The note for a peer that cannot be used: the same reason the strict factory would throw. */
function peerNote(probe: Extract<AiSdkPeerProbe, { ok: false }>): string {
  const supported = SUPPORTED_AI_SDK_VERSION_MATRIX.map((entry) => entry.providerVersion).join(", ");
  if (probe.reason === "missing") {
    return `ai-sdk: ${AI_SDK_PEER} is not installed (optional peer); install it and pass a model with aiSdk({ model })`;
  }
  return `ai-sdk: unsupported ${AI_SDK_PEER} version "${probe.version}"; supported versions: ${supported}`;
}

function definitionFor(options: AiSdkFactoryOptions) {
  return defineProviderPackage<AiSdkProviderConfig>({
    name: "@arnilo/prism-provider-ai-sdk",
    description: "AI SDK bridge provider package for Prism (host-owned LanguageModelV4).",
    capabilities: [],
    config: configSchema,
    setup: async (prism) => {
      const probe = probeAiSdkPeer(options.readVersion);
      if (!probe.ok) {
        // Cannot operate: note and register nothing rather than throwing at setup.
        prism.status.note("warn", peerNote(probe));
        return;
      }
      if (options.model === undefined) {
        prism.status.note("info", `ai-sdk: no host model; pass one with aiSdk({ model }) to register the bridge (peer ${probe.version})`);
        return;
      }
      const provider = createAiSdkProvider({
        model: options.model,
        ...(options.redactor !== undefined ? { redactor: options.redactor } : {}),
        ...(prism.config.id !== undefined ? { id: prism.config.id } : {}),
      });
      const configured = prism.config.models;
      const derived: ModelConfig = { provider: provider.id, model: options.model.modelId, displayName: options.model.modelId };
      prism.providers.register({
        ...provider,
        async models() {
          return configured ?? [derived];
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `aiSdk({ ... })`; the model is factory-only. */
export default definition;

/** Factory-only options: `model`, `redactor`, `readVersion`. `id`/`models` are validated config. */
export type AiSdkFactoryOptions = Pick<AiSdkProviderPackageOptions, "model" | "redactor" | "readVersion">;

/** Instance with factory-only options; `id`/`models` are validated config. */
export function aiSdk(options: AiSdkProviderPackageOptions & AiSdkProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["model", "redactor", "readVersion"], options);
}
