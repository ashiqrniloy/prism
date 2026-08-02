import type { CommandDefinition, JsonObject } from "@arnilo/prism";

import type { PonytailConfig } from "./config.js";
import { writePonytailDefaultMode } from "./config.js";
import type { UpstreamPonytailConfig } from "./upstream-hooks.js";
import type { PonytailMode } from "./types.js";
import type { PonytailSkillName } from "./skills.js";

export interface PonytailCommandContext {
  readonly skills: ReadonlyMap<PonytailSkillName, { readonly name: string; readonly instructions?: string }>;
  readonly upstreamConfig: UpstreamPonytailConfig;
  readonly getMode: () => PonytailMode;
  readonly setMode: (mode: PonytailMode, sessionId?: string) => Promise<void>;
  readonly getConfig: () => PonytailConfig;
  readonly setDefaultMode: (mode: PonytailMode) => void;
  readonly configPath?: string;
}

type ParsedPonytailCommand =
  | { readonly type: "status" }
  | { readonly type: "set-mode"; readonly mode: PonytailMode }
  | { readonly type: "set-default"; readonly mode: PonytailMode }
  | { readonly type: "invalid"; readonly reason: string; readonly mode?: string };

function commandArg(args: JsonObject): string {
  if (typeof args.mode === "string") return args.mode;
  if (typeof args.text === "string") return args.text;
  if (typeof args.args === "string") return args.args;
  return "";
}

function parsePonytailCommand(text: string, defaultMode: PonytailMode, upstream: UpstreamPonytailConfig): ParsedPonytailCommand {
  const normalizedText = text.trim().toLowerCase();
  const fallback = defaultMode;

  if (!normalizedText) {
    return { type: "set-mode", mode: fallback === "off" ? "full" : fallback };
  }

  const [primary, secondary] = normalizedText.split(/\s+/);

  if (primary === "status") return { type: "status" };

  if (primary === "default") {
    const mode = upstream.normalizeMode(secondary) as PonytailMode | null;
    return mode ? { type: "set-default", mode } : { type: "invalid", reason: "invalid-default-mode" };
  }

  const mode = upstream.normalizeMode(primary) as PonytailMode | null;
  return mode ? { type: "set-mode", mode } : { type: "invalid", reason: "invalid-mode", mode: primary };
}

function skillDispatch(name: PonytailSkillName, ctx: PonytailCommandContext): CommandDefinition {
  return {
    name,
    description: `Dispatch upstream Ponytail skill ${name}.`,
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

export function createPonytailCommands(ctx: PonytailCommandContext): readonly CommandDefinition[] {
  const runtimeList = ctx.upstreamConfig.RUNTIME_MODES.join("|");

  return [
    {
      name: "ponytail",
      description: `Set mode: ${runtimeList}. Commands: status, default <mode>.`,
      parameters: {
        type: "object",
        properties: { mode: { type: "string" }, text: { type: "string" }, args: { type: "string" } },
      } as JsonObject,
      async execute(args, context) {
        const parsed = parsePonytailCommand(commandArg(args), ctx.getConfig().defaultMode, ctx.upstreamConfig);

        if (parsed.type === "status") {
          const text = `Ponytail: current ${ctx.getMode()} • default ${ctx.getConfig().defaultMode}`;
          return {
            name: "ponytail",
            value: { mode: ctx.getMode(), defaultMode: ctx.getConfig().defaultMode },
            content: [{ type: "text", text }],
          };
        }

        if (parsed.type === "set-default") {
          if (!ctx.configPath) {
            const message = "configPath required to persist default mode.";
            return { name: "ponytail", error: { message }, content: [{ type: "text", text: message }] };
          }
          try {
            writePonytailDefaultMode(ctx.configPath, parsed.mode);
            ctx.setDefaultMode(parsed.mode);
            const text = `Default Ponytail mode set to ${parsed.mode}.`;
            return { name: "ponytail", value: { defaultMode: parsed.mode }, content: [{ type: "text", text }] };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to save default mode.";
            return { name: "ponytail", error: { message }, content: [{ type: "text", text: message }] };
          }
        }

        if (parsed.type === "set-mode") {
          await ctx.setMode(parsed.mode, context.sessionId);
          const text = parsed.mode === "off" ? "Ponytail mode off." : `Ponytail mode: ${parsed.mode}.`;
          return { name: "ponytail", value: { mode: parsed.mode }, content: [{ type: "text", text }] };
        }

        const message = `Unknown or unsupported /ponytail mode "${parsed.mode ?? ""}".`;
        return { name: "ponytail", error: { message }, content: [{ type: "text", text: message }] };
      },
    },
    skillDispatch("ponytail-review", ctx),
    skillDispatch("ponytail-audit", ctx),
    skillDispatch("ponytail-gain", ctx),
    skillDispatch("ponytail-debt", ctx),
    skillDispatch("ponytail-help", ctx),
  ];
}
