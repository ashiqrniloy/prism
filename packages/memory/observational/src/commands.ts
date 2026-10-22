/**
 * The package's commands: `om` (toggle), `om:model` (worker models), `om:status` (counts), and
 * `om:view` (the rendered ledger).
 *
 * Every command acts on `context.session`; without one it answers with a named refusal instead of
 * throwing, so a host listing commands without a session (conformance, `doctor`) sees data, not a crash.
 */
import type {
  JsonObject,
  JsonSchema,
  JsonValue,
  ModelRef,
  PackageCommand,
  PackageCommandContext,
  SessionContext,
  SessionLog,
  SessionState,
} from "@arnilo/prism";

import type { ResolvedMemoryObservationalConfig } from "./config.js";
import type { ObservationalFlush } from "./flush.js";
import { activeObservations, activeReflections } from "./ledger.js";
import { renderObservationalMemory } from "./render.js";
import {
  ledgerOf,
  readObservationalMemoryState,
  type ObservationalMemoryState,
  storedModelRef,
  toStoredModelRef,
  writeObservationalMemoryState,
} from "./state.js";
import type { ObservationalMemoryLedger } from "./ledger.js";

export interface MemoryCommandDeps {
  readonly contextMode?: (session: SessionContext) => Promise<"none" | "own-compaction" | "pinned">;
  readonly log: SessionLog<JsonValue>;
  readonly state: SessionState<JsonObject>;
  readonly config: ResolvedMemoryObservationalConfig;
  readonly flush: ObservationalFlush;
  /** Emits `om.status` after a toggle. */
  readonly onStatus: (session: SessionContext) => void;
}

const noSession = (name: string) => ({ ok: false, reason: "no_session", text: `${name} needs a session: run it against one.` });

const modelRefSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    observer: {
      description: 'Observer model: "provider/model" or a model object.',
      anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
    },
    reflector: {
      description: 'Reflector model: "provider/model" or a model object.',
      anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
    },
    reset: {
      type: "boolean",
      description: "Clear the stored worker refs so the session's own model is used again.",
    },
  },
};

export function createObservationalMemoryCommands(deps: MemoryCommandDeps): readonly PackageCommand[] {
  return [toggleCommand(deps), modelCommand(deps), statusCommand(deps), viewCommand(deps)];
}

function toggleCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "om",
    description: "Toggle observational memory for this session.",
    run: async (_args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("om");
      const current = readObservationalMemoryState(deps.state.get(session));
      const enabled = !current.enabled;
      await deps.state.set(session, writeObservationalMemoryState({ ...current, enabled }));
      deps.onStatus(session);
      return { ok: true, enabled, text: `Observational memory ${enabled ? "on" : "off"} for this session.` };
    },
  };
}

function modelCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "om:model",
    description: "Set the observer and/or reflector model for this session.",
    args: modelRefSchema,
    run: async (args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("om:model");
      const observer = args.observer as ModelRef | undefined;
      const reflector = args.reflector as ModelRef | undefined;
      const reset = args.reset === true;
      // Resolve before writing: an unknown provider fails the command and leaves state unchanged.
      if (observer !== undefined) context.agent.models.resolve(observer);
      if (reflector !== undefined) context.agent.models.resolve(reflector);
      const current = readObservationalMemoryState(deps.state.get(session));
      const next: ObservationalMemoryState = reset
        ? { enabled: current.enabled }
        : {
            ...current,
            ...(observer === undefined ? {} : { observerModel: toStoredModelRef(observer) }),
            ...(reflector === undefined ? {} : { reflectorModel: toStoredModelRef(reflector) }),
          };
      await deps.state.set(session, writeObservationalMemoryState(next));
      return {
        ok: true,
        observer: observer ?? storedModelRef(next.observerModel) ?? deps.config.observer.model ?? "session",
        reflector: reflector ?? storedModelRef(next.reflectorModel) ?? deps.config.reflector.model ?? "session",
      };
    },
  };
}

function statusCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "om:status",
    description: "Show observational-memory counts, thresholds, and pass state for this session.",
    run: async (_args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("om:status");
      const state = readObservationalMemoryState(deps.state.get(session));
      const ledger = ledgerOf(deps.log.entries(session));
      const active = activeObservations(ledger);
      const status = deps.flush.status(session.id);
      const value = {
        enabled: state.enabled,
        contextMode: await deps.contextMode?.(session) ?? "none",
        observer: storedModelRef(state.observerModel) ?? deps.config.observer.model ?? "session",
        reflector: storedModelRef(state.reflectorModel) ?? deps.config.reflector.model ?? "session",
        observations: {
          recorded: ledger.observations.length,
          dropped: ledger.droppedObservationIds.length,
          active: active.length,
        },
        reflections: { recorded: ledger.reflections.length },
        tokens: { activeObservationPool: active.reduce((sum, item) => sum + item.tokenCount, 0) },
        thresholds: {
          messageTokens: deps.config.observer.messageTokens,
          observationTokens: deps.config.reflector.observationTokens,
          targetTokens: deps.config.dropper.targetTokens,
          compactAfterTokens: deps.config.context.compactAfterTokens,
        },
        inFlight: status.inFlight,
        ...(status.lastError === undefined ? {} : { lastError: status.lastError }),
      };
      const text = [
        `Observational memory ${state.enabled ? "on" : "off"}: ${active.length} active / ${ledger.observations.length} recorded observations (${ledger.droppedObservationIds.length} dropped), ${ledger.reflections.length} reflections.`,
        `Pass: ${status.inFlight ? "in flight" : "idle"}${status.lastError === undefined ? "" : `; last error: ${status.lastError}`}.`,
      ].join("\n");
      return { ...value, text };
    },
  };
}

function viewCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "om:view",
    description: "Render this session's observational memory.",
    run: (_args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("om:view");
      const ledger: ObservationalMemoryLedger = ledgerOf(deps.log.entries(session));

      const observations = activeObservations(ledger);
      const reflections = activeReflections(ledger);
      const text = renderObservationalMemory(reflections, observations, {
        advertiseRecall: false,
        taskState: ledger.taskState,
        maxTaskStateBytes: deps.config.worker.maxTaskStateBytes,
      });
      return { observations: observations.length, reflections: reflections.length, text };
    },
  };
}
