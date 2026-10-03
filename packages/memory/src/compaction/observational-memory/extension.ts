import { definePackage } from "@arnilo/prism";
import { asPackageCommand } from "../../package-command.js";
import { createObservationalMemoryCommands, type MemoryCommandOptions } from "./commands.js";
import { createRecallMemoryTool, type RecallMemoryToolOptions } from "./tool.js";

export interface ObservationalMemoryExtensionOptions {
  readonly recallTool?: RecallMemoryToolOptions;
  readonly commands?: MemoryCommandOptions;
}

/**
 * Function options stay factory arguments. `recall` is package config: the tool is registered only
 * when `recallTool` was supplied, and `when` hides it unless `recall` is true (default).
 */
export function observationalMemory(options: ObservationalMemoryExtensionOptions = {}) {
  return definePackage<{ recall: boolean }>({
    name: "@arnilo/prism-memory.observational-memory",
    version: "0.12.1",
    requires: { prism: "^0.12.1 || ^0.13.0-0" },
    config: {
      type: "object",
      properties: { recall: { type: "boolean", default: true } },
    },
    setup(prism) {
      if (options.recallTool) {
        prism.tools.register(createRecallMemoryTool(options.recallTool), { when: () => prism.config.recall !== false });
      }
      for (const command of options.commands ? createObservationalMemoryCommands(options.commands) : []) {
        prism.commands.register(asPackageCommand(command));
      }
    },
  });
}
