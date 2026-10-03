/** `agent.models` (roadmap §2.3): list and resolve over the providers the agent can see. */
import type { ModelConfig, ModelIndex, ResolvedModel } from "../contracts.js";
import type { LoadedPackages } from "../packages/loader.js";
import type { SecretRedactor } from "../redaction.js";

/**
 * Public fields only. `parameters`, `compat` and `metadata` can carry endpoints, headers or other
 * configuration that holds a secret, so a listing never includes them.
 */
function publicModel(model: ModelConfig, providerId: string): ModelConfig {
  const { provider: _provider, parameters: _parameters, compat: _compat, metadata: _metadata, ...rest } = model;
  return { ...rest, provider: providerId };
}

export function createModelIndex(sources: {
  readonly configured: ModelConfig;
  readonly packages: () => LoadedPackages;
  readonly redactor: () => SecretRedactor | undefined;
}): ModelIndex {
  return {
    async list() {
      const seen = new Set<string>();
      const models: ModelConfig[] = [];
      const add = (model: ModelConfig, providerId: string) => {
        const key = `${providerId}\u0000${model.model}`;
        if (seen.has(key)) return;
        seen.add(key);
        models.push(publicModel(model, providerId));
      };
      for (const { provider } of sources.packages().providers()) {
        if (typeof provider.models !== "function") continue;
        for (const model of await provider.models()) add(model, provider.id);
      }
      // A provider without discovery still serves the configured model, so the list is never silently empty.
      add(sources.configured, sources.configured.provider);
      const redactor = sources.redactor();
      const plain = JSON.parse(JSON.stringify(models)) as ModelConfig[];
      const safe = redactor ? redactor.redact(plain) : plain;
      return Object.freeze(safe.map((model) => Object.freeze(model)));
    },
    resolve(ref): ResolvedModel {
      if (typeof ref !== "object" || ref === null || typeof ref.provider !== "string" || typeof ref.model !== "string") {
        throw new TypeError("agent.models.resolve requires a model reference with a provider and a model");
      }
      return { provider: sources.packages().resolveProvider(ref), model: ref };
    },
  };
}
