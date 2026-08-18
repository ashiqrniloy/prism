import type { Extension, Message } from "@arnilo/prism";

import { type CavemanCommandContext, createCavemanCommands, readInitialConfig } from "./commands.js";
import type { CavemanConfig } from "./config.js";
import { extractUserText, isDeactivationCommand, persistLevel, resolveLevelFromEntries } from "./mode.js";
import { buildCavemanInstructions } from "./prompts.js";
import { loadUpstreamSkills, requireCavemanSkills } from "./skills.js";
import type { CavemanExtensionOptions, CavemanLevel } from "./types.js";
import { resolveUpstreamRoot } from "./upstream.js";

const INJECTOR_NAME = "caveman-mode";

export function createCavemanExtension(options: CavemanExtensionOptions): Extension {
  return {
    name: "@arnilo/prism-caveman",
    async setup(api) {
      const upstreamRoot = resolveUpstreamRoot({ upstreamPath: options.upstreamPath });
      const skills = requireCavemanSkills(loadUpstreamSkills(upstreamRoot));
      let config: CavemanConfig = readInitialConfig(options.configPath, options.defaultLevel, options.showStatus);
      let level: CavemanLevel = "off";

      const restore = async () => {
        const entries = await options.getEntries();
        const restored = resolveLevelFromEntries(entries);
        if (restored !== undefined) {
          level = restored;
          return;
        }
        if (config.defaultLevel !== "off") {
          level = config.defaultLevel;
        }
      };

      await restore();

      const setLevel = async (next: CavemanLevel, sessionId?: string) => {
        level = next;
        if (sessionId) {
          await persistLevel({
            sessionId,
            level: next,
            getEntries: options.getEntries,
            appendEntry: options.appendEntry,
          });
        }
        if (config.showStatus) {
          await api.emit({
            type: "caveman:status",
            extension: "@arnilo/prism-caveman",
            metadata: { level: next, showStatus: true },
          });
        }
      };

      const commandCtx: CavemanCommandContext = {
        skills,
        getLevel: () => level,
        setLevel,
        getConfig: () => config,
        setConfig: (next) => {
          config = next;
        },
        configPath: options.configPath,
        emitStatus: config.showStatus ? (next) => setLevel(next) : undefined,
      };

      for (const skill of skills.values()) api.registerSkill(skill);
      for (const command of createCavemanCommands(commandCtx)) api.registerCommand(command);

      api.registerInstructionInjector({
        name: INJECTOR_NAME,
        description: "Inject active caveman level instructions from upstream SKILL.md.",
        apply(ctx) {
          const userText = extractUserText(ctx.input);
          if (isDeactivationCommand(userText)) {
            void setLevel("off", ctx.sessionId);
            return { when: "every_turn" };
          }
          if (level === "off") return { when: "every_turn" };
          const instructions = buildCavemanInstructions(upstreamRoot, level);
          return instructions ? { when: "every_turn", instructions } : { when: "every_turn" };
        },
      });

      api.use<Message[]>("input_assembly", async (messages, next) => {
        const userText = extractUserText(messages);
        if (isDeactivationCommand(userText)) level = "off";
        return next(messages);
      });
    },
  };
}
