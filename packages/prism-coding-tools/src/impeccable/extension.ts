import { definePackage, type CommandDefinition, type PackageCommand } from "@arnilo/prism";

import { createImpeccableCommand } from "./commands.js";
import { loadImpeccableSkill } from "./skills.js";
import type { ImpeccableExtensionOptions } from "./types.js";
import { resolveUpstreamRoot } from "./upstream.js";

function asPackageCommand(command: CommandDefinition): PackageCommand {
  return {
    name: command.name,
    description: command.description ?? command.name,
    run: (args) => command.execute(args, {}),
  };
}

/** `upstreamPath` is package config. A missing or drifting checkout fails setup closed. */
export function impeccable(options: ImpeccableExtensionOptions = { upstreamPath: "" }) {
  return definePackage<{ upstreamPath: string; expectedSnapshotDigest?: string }>({
    name: "@arnilo/prism-coding-tools.impeccable",
    version: "0.12.1",
    requires: { prism: "^0.12.1 || ^0.13.0-0" },
    config: {
      type: "object",
      properties: {
        upstreamPath: { type: "string", default: "" },
        expectedSnapshotDigest: { type: "string" },
      },
    },
    setup(prism) {
      const resolved = resolveUpstreamRoot({ upstreamPath: prism.config.upstreamPath });
      prism.skills.register(loadImpeccableSkill(resolved.root, resolved.skillRelativePath, prism.config.expectedSnapshotDigest));
      prism.commands.register(asPackageCommand(createImpeccableCommand()));
    },
  })({
    upstreamPath: options.upstreamPath,
    ...(options.expectedSnapshotDigest ? { expectedSnapshotDigest: options.expectedSnapshotDigest } : {}),
  });
}
