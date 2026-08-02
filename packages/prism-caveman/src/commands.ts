import type { CommandDefinition, JsonObject } from "@arnilo/prism";

import { readCavemanConfig, type CavemanConfig } from "./config.js";
import type { CavemanLevel } from "./types.js";
import { normalizeLevelArg } from "./mode.js";
import type { CavemanSkillName } from "./skills.js";

export interface CavemanCommandContext {
  readonly skills: ReadonlyMap<CavemanSkillName, { readonly name: string; readonly instructions?: string }>;
  readonly getLevel: () => CavemanLevel;
  readonly setLevel: (level: CavemanLevel, sessionId?: string) => Promise<void>;
  readonly getConfig: () => CavemanConfig;
  readonly setConfig: (config: CavemanConfig) => void;
  readonly configPath?: string;
  readonly emitStatus?: (level: CavemanLevel) => Promise<void>;
}

function commandArg(args: JsonObject): string {
  if (typeof args.level === "string") return args.level;
  if (typeof args.text === "string") return args.text;
  if (typeof args.args === "string") return args.args;
  return "";
}

function skillDispatch(name: CavemanSkillName, ctx: CavemanCommandContext): CommandDefinition {
  return {
    name,
    description: `Dispatch upstream Caveman skill ${name}.`,
    parameters: { type: "object" } as JsonObject,
    execute() {
      const skill = ctx.skills.get(name);
      const preview = skill?.instructions?.split("\n").find((line) => line.trim() && !line.startsWith("#")) ?? "";
      return {
        name,
        value: { skill: name, dispatch: "load_skill" },
        content: [{ type: "text", text: preview ? `Skill ${name}: ${preview}` : `Load skill ${name}.` }],
        metadata: { skill: name },
      };
    },
  };
}

export function createCavemanCommands(ctx: CavemanCommandContext): readonly CommandDefinition[] {
  const commands: CommandDefinition[] = [
    {
      name: "caveman",
      description: "Set caveman intensity (lite|full|ultra|wenyan|micro|off) or toggle when no arg.",
      parameters: {
        type: "object",
        properties: { level: { type: "string" }, text: { type: "string" }, args: { type: "string" } },
      } as JsonObject,
      async execute(args, context) {
        const raw = commandArg(args).trim().toLowerCase();
        let level: CavemanLevel;
        if (!raw) {
          level = ctx.getLevel() === "off" ? "full" : "off";
        } else if (raw === "config") {
          const config = ctx.getConfig();
          const text = `defaultLevel=${config.defaultLevel}, showStatus=${config.showStatus}`;
          return { name: "caveman", value: { config }, content: [{ type: "text", text }] };
        } else {
          const normalized = normalizeLevelArg(raw);
          if (!normalized) {
            const message = `Unknown level "${raw}". Use lite|full|ultra|wenyan|micro|off.`;
            return { name: "caveman", error: { message }, content: [{ type: "text", text: message }] };
          }
          level = normalized;
        }
        await ctx.setLevel(level, context.sessionId);
        const text = level === "off" ? "Caveman mode off." : `Caveman level: ${level}.`;
        return { name: "caveman", value: { level }, content: [{ type: "text", text }] };
      },
    },
    {
      name: "caveman-init",
      description: "Show upstream caveman-init guidance for the current repo.",
      parameters: { type: "object" } as JsonObject,
      execute() {
        const text =
          "Run upstream caveman-init for per-repo agent rules. In a caveman checkout: node src/tools/caveman-init.js [--dry-run|--force].";
        return {
          name: "caveman-init",
          value: { dispatch: "upstream_init" },
          content: [{ type: "text", text }],
        };
      },
    },
    skillDispatch("caveman-commit", ctx),
    skillDispatch("caveman-review", ctx),
    skillDispatch("caveman-stats", ctx),
    skillDispatch("caveman-compress", ctx),
  ];
  return commands;
}

export function readInitialConfig(configPath: string | undefined, defaultLevel?: CavemanLevel, showStatus?: boolean): CavemanConfig {
  const file = readCavemanConfig(configPath);
  return {
    defaultLevel: defaultLevel ?? file.defaultLevel,
    showStatus: showStatus ?? file.showStatus,
  };
}
