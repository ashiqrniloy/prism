import type { CommandDefinition, JsonObject, SessionEntry } from "prism";
import { activeObservations, foldObservationalMemoryLedger } from "./ledger.js";
import { buildObservationalMemoryProjection } from "./projection.js";
import { renderObservationalMemory } from "./render.js";
import { resolveObservationalMemorySettings, type ObservationalMemorySettingsInput } from "./settings.js";
import { estimateEntryTokens } from "./tokens.js";
import type { GetMemoryEntries } from "./tool.js";

export interface MemoryCommandOptions {
  readonly getEntries: GetMemoryEntries;
  readonly secrets?: readonly (string | undefined)[];
  readonly settings?: ObservationalMemorySettingsInput;
  readonly runtimeStatus?: () => { readonly inFlight: boolean; readonly lastError?: string };
}

export function createMemoryStatusCommand(options: MemoryCommandOptions): CommandDefinition {
  return {
    name: "om:status",
    description: "Show observational-memory counts and thresholds for the current session.",
    parameters: { type: "object" } as JsonObject,
    async execute(_args, context) {
      const entries = await requireEntries(options, context.sessionId);
      const ledger = foldObservationalMemoryLedger(entries);
      const projection = buildObservationalMemoryProjection(entries);
      const active = activeObservations(ledger);
      const settings = await resolveObservationalMemorySettings(undefined, options.settings);
      const activeTokens = active.reduce((sum, item) => sum + item.tokenCount, 0);
      const rawTokens = entries.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
      const status = options.runtimeStatus?.();
      const value = {
        observations: { recorded: ledger.observations.length, dropped: ledger.droppedObservationIds.length, active: active.length, visible: projection.observations.length },
        reflections: { recorded: ledger.reflections.length, visible: projection.reflections.length },
        tokens: { raw: rawTokens, activeObservationPool: activeTokens, observationsPoolTarget: settings.observationsPoolTargetTokens, observationsPoolMax: settings.observationsPoolMaxTokens },
        runtime: status ?? { inFlight: false },
      };
      const text = [
        `Observational memory: ${value.observations.active} active / ${value.observations.recorded} recorded observations (${value.observations.dropped} dropped), ${value.reflections.recorded} reflections.`,
        `Pool: ${activeTokens}/${settings.observationsPoolTargetTokens} target tokens, max ${settings.observationsPoolMaxTokens}.`,
        `Runtime: ${value.runtime.inFlight ? "in flight" : "idle"}${value.runtime.lastError ? `; last error: ${value.runtime.lastError}` : ""}.`,
      ].join("\n");
      return { name: "om:status", value, content: [{ type: "text", text }] };
    },
  };
}

export function createMemoryViewCommand(options: MemoryCommandOptions): CommandDefinition {
  return {
    name: "om:view",
    description: "Render visible observational memory, or full recorded memory with mode=full.",
    parameters: { type: "object", properties: { mode: { type: "string" } } } as JsonObject,
    async execute(args, context) {
      const mode = typeof args.mode === "string" ? args.mode : undefined;
      if (mode && mode !== "full") return { name: "om:view", error: { message: "Usage: /om:view [full]" }, content: [{ type: "text", text: "Usage: /om:view [full]" }] };
      const entries = await requireEntries(options, context.sessionId);
      const projection = buildObservationalMemoryProjection(entries);
      const observations = mode === "full" ? activeObservations(projection.full) : projection.observations;
      const reflections = mode === "full" ? projection.full.reflections : projection.reflections;
      const text = renderObservationalMemory(reflections, observations, options.secrets);
      return { name: "om:view", value: { mode: mode ?? "visible", observations: observations.length, reflections: reflections.length, text }, content: [{ type: "text", text }] };
    },
  };
}

export function createObservationalMemoryCommands(options: MemoryCommandOptions): readonly CommandDefinition[] {
  return [createMemoryStatusCommand(options), createMemoryViewCommand(options)];
}

async function requireEntries(options: MemoryCommandOptions, sessionId: string | undefined): Promise<readonly SessionEntry[]> {
  if (!sessionId) throw new Error("Observational memory command requires a sessionId");
  return options.getEntries(sessionId);
}
