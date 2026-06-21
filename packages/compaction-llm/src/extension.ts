import type { Extension } from "prism";
import { createLlmCompactionStrategy, type LlmCompactionStrategyOptions } from "./strategy.js";

export interface LlmCompactionExtensionOptions extends LlmCompactionStrategyOptions {
  readonly extensionName?: string;
}

export function createLlmCompactionExtension(options: LlmCompactionExtensionOptions): Extension {
  return {
    name: options.extensionName ?? "@prism/compaction-llm",
    setup(api) {
      api.registerCompactionStrategy(createLlmCompactionStrategy(options));
    },
  };
}
