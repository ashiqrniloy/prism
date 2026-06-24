import type { Extension } from "@arnilo/prism";
import { createLlmCompactionStrategy, type LlmCompactionStrategyOptions } from "./strategy.js";

export interface LlmCompactionExtensionOptions extends LlmCompactionStrategyOptions {
  readonly extensionName?: string;
}

export function createLlmCompactionExtension(options: LlmCompactionExtensionOptions): Extension {
  return {
    name: options.extensionName ?? "@arnilo/prism-compaction-llm",
    setup(api) {
      api.registerCompactionStrategy(createLlmCompactionStrategy(options));
    },
  };
}
