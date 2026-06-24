import type { Extension } from "@arnilo/prism";
import { createObservationalMemoryCommands, type MemoryCommandOptions } from "./commands.js";
import { createObservationalMemoryCompactionStrategy, type ObservationalMemoryCompactionStrategyOptions } from "./strategy.js";
import { createRecallMemoryTool, type RecallMemoryToolOptions } from "./tool.js";

export interface ObservationalMemoryExtensionOptions extends ObservationalMemoryCompactionStrategyOptions {
  readonly extensionName?: string;
  readonly registerCompactionStrategy?: boolean;
  readonly recallTool?: RecallMemoryToolOptions;
  readonly commands?: MemoryCommandOptions;
}

export function createObservationalMemoryExtension(options: ObservationalMemoryExtensionOptions = {}): Extension {
  return {
    name: options.extensionName ?? "@arnilo/prism-compaction-observational-memory",
    setup(api) {
      if (options.registerCompactionStrategy !== false) {
        api.registerCompactionStrategy(createObservationalMemoryCompactionStrategy(options));
      }
      if (options.recallTool) api.registerTool(createRecallMemoryTool(options.recallTool));
      for (const command of options.commands ? createObservationalMemoryCommands(options.commands) : []) api.registerCommand(command);
    },
  };
}
