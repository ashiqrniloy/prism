/** `agent.models` (roadmap §2.3): list and resolve over the providers the agent can see. */
import type { ModelConfig, ModelIndex, ModelSpec, ResolvedModel } from "../contracts.js";
import { parseModelRef } from "../models/ref.js";
import type { LoadedPackages } from "../packages/loader.js";
import type { SecretRedactor } from "../redaction.js";

/**
 * Public fields only. `parameters`, `compat`, `metadata`, `options`, `baseUrl` and `credential` can carry
 * endpoints, headers or other configuration that holds a secret, so a listing never includes them.
 */
function publicModel(model: ModelSpec, providerId: string): ModelConfig {
  const {
    provider: _provider,
    parameters: _parameters,
    compat: _compat,
    metadata: _metadata,
    options: _options,
    baseUrl: _baseUrl,
    credential: _credential,
    ...rest
  } = model;
  return { ...rest, provider: providerId };
}

export function createModelIndex(sources: {
  readonly configured: ModelSpec | undefined;
  readonly packages: () => LoadedPackages;
  readonly redactor: () => SecretRedactor | undefined;
}): ModelIndex {
  return {
    async list() {
      const seen = new Set<string>();
      const models: ModelConfig[] = [];
      const add = (model: ModelSpec, providerId: string) => {
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
      if (sources.configured) add(sources.configured, sources.configured.provider);
      const redactor = sources.redactor();
      const plain = JSON.parse(JSON.stringify(models)) as ModelConfig[];
      const safe = redactor ? redactor.redact(plain) : plain;
      return Object.freeze(safe.map((model) => Object.freeze(model)));
    },
    resolve(ref): ResolvedModel {
      const model = parseModelRef(ref);
      return { provider: sources.packages().resolveProvider(model), model };
    },
  };
}
