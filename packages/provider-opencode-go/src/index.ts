import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { openCodeGoModels } from "./models.js";
import { createOpenCodeGoProvider, type OpenCodeGoProviderOptions } from "./provider.js";

export interface OpenCodeGoProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly models?: readonly ModelConfig[];
}

export function createOpenCodeGoProviderPackage(options: OpenCodeGoProviderPackageOptions = {}): ProviderPackage {
  return defineProviderPackage({
    name: "@arnilo/prism-provider-opencode-go",
    description: "OpenCode Go provider package for Prism.",
    docs: { links: ["docs/providers/opencode-go.md"] },
    setup(api) {
      api.registerProvider(createOpenCodeGoProvider(options));
      for (const model of options.models ?? openCodeGoModels) api.registerModel(model);
      api.registerAuthMethod({ kind: "api_key", provider: "opencode-go", credentialName: "apiKey" });
    },
  });
}

export { createOpenCodeGoProvider, type OpenCodeGoProviderOptions } from "./provider.js";
export { openCodeGoModels } from "./models.js";
