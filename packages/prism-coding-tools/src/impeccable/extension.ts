import type { Extension } from "@arnilo/prism";

import { createImpeccableCommand } from "./commands.js";
import { loadImpeccableSkill } from "./skills.js";
import type { ImpeccableExtensionOptions } from "./types.js";
import { resolveUpstreamRoot } from "./upstream.js";

export function createImpeccableExtension(options: ImpeccableExtensionOptions): Extension {
  return {
    name: "@arnilo/prism-coding-tools/impeccable",
    async setup(api) {
      const resolved = resolveUpstreamRoot({ upstreamPath: options.upstreamPath });
      api.registerSkill(loadImpeccableSkill(resolved.root, resolved.skillRelativePath));
      api.registerCommand(createImpeccableCommand());
    },
  };
}
