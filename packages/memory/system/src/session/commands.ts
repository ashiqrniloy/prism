/**
 * The package's session commands: `memory:session` (toggle), `memory:session:model` (worker models),
 * `memory:session:status` (counts), and `memory:session:view` (the rendered ledger).
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

import type { ResolvedMemorySystemConfig } from "./config.js";
import type { ObservationalFlush } from "./flush.js";
import type { ObservationalMemoryLedger } from "./ledger.js";
import { activeObservations, activeReflections } from "./ledger.js";
import { renderObservationalMemory } from "./render.js";
import {
  ledgerOf,
  type ObservationalMemoryState,
  readObservationalMemoryState,
  storedModelRef,
  toStoredModelRef,
  writeObservationalMemoryState,
} from "./state.js";

export interface MemoryCommandDeps {
  readonly contextMode?: (session: SessionContext) => Promise<"none" | "own-compaction" | "pinned">;
  readonly log: SessionLog<JsonValue>;
  readonly state: SessionState<JsonObject>;
  readonly config: ResolvedMemorySystemConfig;
  readonly flush: ObservationalFlush;
  /** Emits `memory.session.status` after a toggle. */
  readonly onStatus: (session: SessionContext) => void;
}

const noSession = (name: string) => ({ ok: false, reason: "no_session", text: `${name} needs a session: run it against one.` });

const modelRefSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    stm: {
      description: 'STM worker model: "provider/model" or a model object.',
      anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
    },
    wm: {
      description: 'WM worker model: "provider/model" or a model object.',
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
    name: "memory:session",
    description: "Toggle session memory for this session.",
    run: async (_args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("memory:session");
      const current = readObservationalMemoryState(deps.state.get(session));
      const enabled = !current.enabled;
      await deps.state.set(session, writeObservationalMemoryState({ ...current, enabled }));
      deps.onStatus(session);
      return { ok: true, enabled, text: `Session memory ${enabled ? "on" : "off"} for this session.` };
    },
  };
}

function modelCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "memory:session:model",
    description: "Set the STM and/or WM worker model for this session.",
    args: modelRefSchema,
    run: async (args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("memory:session:model");
      const stm = args.stm as ModelRef | undefined;
      const wm = args.wm as ModelRef | undefined;
      const reset = args.reset === true;
      // Resolve before writing: an unknown provider fails the command and leaves state unchanged.
      if (stm !== undefined) context.agent.models.resolve(stm);
      if (wm !== undefined) context.agent.models.resolve(wm);
      const current = readObservationalMemoryState(deps.state.get(session));
      const next: ObservationalMemoryState = reset
        ? { enabled: current.enabled }
        : {
            ...current,
            ...(stm === undefined ? {} : { stmModel: toStoredModelRef(stm) }),
            ...(wm === undefined ? {} : { wmModel: toStoredModelRef(wm) }),
          };
      await deps.state.set(session, writeObservationalMemoryState(next));
      return {
        ok: true,
        stm: stm ?? storedModelRef(next.stmModel) ?? deps.config.stm.model ?? "session",
        wm: wm ?? storedModelRef(next.wmModel) ?? deps.config.wm.model ?? "session",
      };
    },
  };
}

function statusCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "memory:session:status",
    description: "Show session-memory counts, thresholds, and pass state for this session.",
    run: async (_args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("memory:session:status");
      const state = readObservationalMemoryState(deps.state.get(session));
      const ledger = ledgerOf(deps.log.entries(session));
      const active = activeObservations(ledger);
      const status = deps.flush.status(session.id);
      const value = {
        enabled: state.enabled,
        contextMode: (await deps.contextMode?.(session)) ?? "none",
        stm: storedModelRef(state.stmModel) ?? deps.config.stm.model ?? "session",
        wm: storedModelRef(state.wmModel) ?? deps.config.wm.model ?? "session",
        observations: {
          recorded: ledger.observations.length,
          dropped: ledger.droppedObservationIds.length,
          active: active.length,
        },
        reflections: { recorded: ledger.reflections.length },
        tokens: { activeObservationPool: active.reduce((sum, item) => sum + item.tokenCount, 0) },
        thresholds: {
          triggerTokens: deps.config.stm.triggerTokens,
          observationTokens: deps.config.wm.observationTokens,
          targetTokens: deps.config.rehearsal.targetTokens,
          compactAt: deps.config.context.compactAt,
        },
        inFlight: status.inFlight,
        ...(status.lastError === undefined ? {} : { lastError: status.lastError }),
      };
      const text = [
        `Session memory ${state.enabled ? "on" : "off"}: ${active.length} active / ${ledger.observations.length} recorded observations (${ledger.droppedObservationIds.length} dropped), ${ledger.reflections.length} reflections.`,
        `Pass: ${status.inFlight ? "in flight" : "idle"}${status.lastError === undefined ? "" : `; last error: ${status.lastError}`}.`,
      ].join("\n");
      return { ...value, text };
    },
  };
}

function viewCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "memory:session:view",
    description: "Render this session's session memory.",
    run: (_args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("memory:session:view");
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
