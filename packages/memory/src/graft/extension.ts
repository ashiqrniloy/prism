import { join } from "node:path";

import type { Extension } from "@arnilo/prism";

import {
  childEnv,
  childTimeoutMs,
  DEFAULT_BUILD_BUDGET_MS,
  DEFAULT_BUILD_MAX_RESULT_BYTES,
  DEFAULT_DEEP_BUILD_BUDGET_MS,
  DEFAULT_MAX_RESULT_BYTES,
  runGraftJson,
} from "./cli.js";
import type { GraftCommandContext } from "./commands.js";
import { createGraftCommands } from "./commands.js";
import { wireEditWatch } from "./edit-watch.js";
import { createGraftContextProvider, createGraftOrientationInjector, loadOrientation, nextSeen } from "./injector.js";
import { createGraftSkill } from "./skills.js";
import { persistGraftPatch, resolveLatestGraftState } from "./state.js";
import { defineGraftTools, shouldRegisterPullTools } from "./tools.js";
import type { GraftDeepModel, GraftExtensionOptions, GraftFreshness, GraftMode } from "./types.js";
import { resolveGraftCli } from "./upstream.js";

export const GRAFT_EXTENSION_NAME = "@arnilo/prism-memory/graft";

/** `deepModel` merged over `providerEnv` — both filtered to `GRAFT_*`; deepModel wins on conflict. */
export function deepProviderEnv(
  deepModel: GraftDeepModel | undefined,
  providerEnv: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(providerEnv ?? {})) {
    if (/^GRAFT_[A-Z0-9_]+$/.test(key)) env[key] = value;
  }
  if (deepModel) {
    env.GRAFT_PROVIDER = deepModel.provider;
    env.GRAFT_MODEL = deepModel.model;
    env.GRAFT_API_KEY = deepModel.apiKey;
    if (deepModel.baseUrl) env.GRAFT_BASE_URL = deepModel.baseUrl;
  }
  return env;
}

/** Resolve options to concrete values (single source for setup and tests). */
export function resolveExtension(options: GraftExtensionOptions) {
  const cli = resolveGraftCli({
    cliPath: options.cliPath,
    packageRoot: options.packageRoot,
    packageName: options.packageName,
  });
  const childEnvOptions = {
    allowUpstreamTelemetry: options.allowUpstreamTelemetry,
    providerEnv: deepProviderEnv(options.deepModel, options.providerEnv),
  };
  return {
    cli,
    mode: options.mode ?? "pull",
    projectDir: options.projectDir ?? process.cwd(),
    timeoutMs: childTimeoutMs(options.retrievalBudgetMs),
    maxResultBytes: options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
    env: childEnv(childEnvOptions),
    cliOptions: childEnvOptions,
    buildTimeoutMs: childTimeoutMs(options.buildBudgetMs, DEFAULT_BUILD_BUDGET_MS),
    deepBuildTimeoutMs: childTimeoutMs(options.deepBuildBudgetMs, DEFAULT_DEEP_BUILD_BUDGET_MS),
    buildMaxResultBytes: options.buildMaxResultBytes ?? DEFAULT_BUILD_MAX_RESULT_BYTES,
    init: { agents: options.initAgents ?? [], yes: options.initYes === true, wireMcp: options.initWireMcp === true },
  };
}

export function shouldRegisterPushSurface(mode: GraftMode): boolean {
  return mode === "push" || mode === "both";
}

/**
 * Inert until `kernel.load([...])`. Setup resolves the graft CLI and fails closed
 * (bounded, redacted `GraftResolveError`) when neither `cliPath`, `packageRoot`,
 * nor the optional `@nanonets/graft` peer is available.
 */
export function createGraftExtension(options: GraftExtensionOptions): Extension {
  return {
    name: GRAFT_EXTENSION_NAME,
    async setup(api) {
      const resolved = resolveExtension(options);

      if (!options.quietStartup) {
        await api.emit({
          type: "graft:loaded",
          extension: GRAFT_EXTENSION_NAME,
          metadata: { mode: resolved.mode, cliKind: resolved.cli.kind },
        });
      }

      const emitStatus = async (metadata: Readonly<Record<string, unknown>>) => {
        if (options.hideStatus) return;
        await api.emit({ type: "graft:status", extension: GRAFT_EXTENSION_NAME, metadata: { ...metadata } });
      };

      const commandCtx: GraftCommandContext = {
        cli: resolved.cli,
        projectDir: resolved.projectDir,
        mode: resolved.mode,
        timeoutMs: resolved.timeoutMs,
        maxResultBytes: resolved.maxResultBytes,
        childEnv: resolved.env,
        buildTimeoutMs: resolved.buildTimeoutMs,
        deepBuildTimeoutMs: resolved.deepBuildTimeoutMs,
        buildMaxResultBytes: resolved.buildMaxResultBytes,
        init: resolved.init,
        getEntries: options.getEntries,
        appendEntry: (entry, appendOptions) => options.appendEntry(entry, { expectedParentId: appendOptions?.expectedParentId }),
        emitStatus,
      };

      let skill = createGraftSkill();

      if (shouldRegisterPushSurface(resolved.mode)) {
        wireEditWatch(api, {
          cliCommand: [resolved.cli.command, ...resolved.cli.args],
          cwd: resolved.projectDir,
          timeoutMs: resolved.timeoutMs,
          maxResultBytes: resolved.maxResultBytes,
          env: resolved.env,
          projectDir: resolved.projectDir,
          getEntries: options.getEntries,
          appendEntry: (entry, appendOptions) => options.appendEntry(entry, { expectedParentId: appendOptions?.expectedParentId }),
          emit: (event) => api.emit({ type: event.type, extension: event.extension, metadata: event.metadata }),
          editToolNames: options.editToolNames,
        });

        skill = {
          ...skill,
          context: [
            createGraftContextProvider({
              runAsk: async (query) =>
                (
                  await runGraftJson(resolved.cli, ["ask", query, ".", "--json", "-n", "3"], {
                    cwd: resolved.projectDir,
                    timeoutMs: resolved.timeoutMs,
                    maxResultBytes: resolved.maxResultBytes,
                    env: resolved.env,
                  })
                ).value,
              getSeen: async () => {
                const state = resolveLatestGraftState(await options.getEntries());
                return { ids: new Set(state?.seen ?? []), savedTokensApprox: state?.savedTokensApprox ?? 0 };
              },
              onEmitted: (freshIds, saved, sessionId) => {
                void (async () => {
                  const latest = resolveLatestGraftState(await options.getEntries());
                  await persistGraftPatch({
                    sessionId,
                    patch: {
                      seen: nextSeen({ ids: new Set(latest?.seen ?? []), savedTokensApprox: latest?.savedTokensApprox ?? 0 }, freshIds),
                      savedTokensApprox: (latest?.savedTokensApprox ?? 0) + saved,
                    },
                    getEntries: options.getEntries,
                    appendEntry: (entry, appendOptions) =>
                      options.appendEntry(entry, { expectedParentId: appendOptions?.expectedParentId }),
                  });
                })().catch(() => {});
              },
            }),
          ],
        };

        // ponytail: freshness snapshot at load time — the injector seam is synchronous;
        // refresh happens on the next /graft check instead of per-turn.
        let freshness: GraftFreshness | undefined;
        try {
          freshness = resolveLatestGraftState(await options.getEntries())?.lastCheck;
        } catch {
          /* banner degrades to unstated */
        }
        api.registerInstructionInjector(
          createGraftOrientationInjector(() => loadOrientation(join(resolved.projectDir, "graft", "INDEX.md"), freshness)),
        );
      }

      api.registerSkill(skill);
      for (const command of createGraftCommands(commandCtx)) api.registerCommand(command);

      if (shouldRegisterPullTools(resolved.mode)) {
        for (const tool of defineGraftTools({
          cli: resolved.cli,
          projectDir: resolved.projectDir,
          timeoutMs: resolved.timeoutMs,
          maxResultBytes: resolved.maxResultBytes,
          childEnv: resolved.env,
        })) {
          api.registerTool(tool);
        }
      }
    },
  };
}
