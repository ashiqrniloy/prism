import type { Extension, Message } from "@arnilo/prism";
import { createPonytailCommands, type PonytailCommandContext } from "./commands.js";
import { type PonytailConfig, readInitialConfig } from "./config.js";
import { buildPonytailInstructions } from "./instructions.js";
import { extractUserText, persistMode, resolveModeFromEntries } from "./mode.js";
import { loadUpstreamSkills, requirePonytailSkills } from "./skills.js";
import type { PonytailExtensionOptions, PonytailMode } from "./types.js";
import { resolveUpstreamRoot } from "./upstream.js";
import { loadUpstreamHooks } from "./upstream-hooks.js";

const INJECTOR_NAME = "ponytail-mode";

export function createPonytailExtension(options: PonytailExtensionOptions): Extension {
  return {
    name: "@arnilo/prism-ponytail",
    async setup(api) {
      const upstreamRoot = resolveUpstreamRoot({
        upstreamPath: options.upstreamPath,
        packageName: options.packageName,
      });
      const hooks = loadUpstreamHooks(upstreamRoot);
      const skills = requirePonytailSkills(loadUpstreamSkills(upstreamRoot));
      let config: PonytailConfig = readInitialConfig(options.configPath, options.defaultMode, options.quietStartup);
      let mode: PonytailMode = "off";

      const restore = async () => {
        const entries = await options.getEntries();
        const restored = resolveModeFromEntries(entries);
        if (restored !== undefined) {
          mode = restored;
          return;
        }
        if (config.defaultMode !== "off") {
          mode = config.defaultMode;
        }
      };

      await restore();

      if (!config.quietStartup) {
        await api.emit({
          type: "ponytail:loaded",
          extension: "@arnilo/prism-ponytail",
          metadata: { mode },
        });
      }

      const emitStatus = async (next: PonytailMode) => {
        if (config.hideStatus) return;
        await api.emit({
          type: "ponytail:status",
          extension: "@arnilo/prism-ponytail",
          metadata: { mode: next, hideStatus: false },
        });
      };

      const setMode = async (next: PonytailMode, sessionId?: string) => {
        mode = next;
        if (sessionId) {
          await persistMode({
            sessionId,
            mode: next,
            getEntries: options.getEntries,
            appendEntry: options.appendEntry,
          });
        }
        await emitStatus(next);
      };

      const commandCtx: PonytailCommandContext = {
        skills,
        upstreamConfig: hooks.config,
        getMode: () => mode,
        setMode,
        getConfig: () => config,
        setDefaultMode: (next) => {
          config = { ...config, defaultMode: next };
        },
        configPath: options.configPath,
      };

      for (const skill of skills.values()) api.registerSkill(skill);
      for (const command of createPonytailCommands(commandCtx)) api.registerCommand(command);

      api.registerInstructionInjector({
        name: INJECTOR_NAME,
        description: "Inject active ponytail mode instructions from upstream hooks.",
        apply(ctx) {
          const userText = extractUserText(ctx.input);
          if (hooks.config.isDeactivationCommand(userText)) {
            void setMode("off", ctx.sessionId);
            return { when: "every_turn" };
          }
          if (mode === "off") return { when: "every_turn" };
          const instructions = buildPonytailInstructions(hooks.instructions, mode);
          return instructions ? { when: "every_turn", instructions } : { when: "every_turn" };
        },
      });

      api.use<Message[]>("input_assembly", async (messages, next) => {
        const userText = extractUserText(messages);
        if (hooks.config.isDeactivationCommand(userText)) mode = "off";
        return next(messages);
      });
    },
  };
}
